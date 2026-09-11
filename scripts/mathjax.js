'use strict';

/**
 * 让文章里的 $...$ / $$...$$ 公式正常渲染。做两件事：
 *
 * 1. 给文章和独立页面注入 MathJax（见文件末尾的 injector）。
 *    - MathJax 本体用本地文件（source/js/mathjax/），不走 CDN，免得国内加载失败；
 *      文件是从 npm 包 mathjax@3 的 es5/ 目录里拷出来的，要升级就重装后再拷一次。
 *    - 用的是 tex-chtml-full.js（内置全部 TeX 宏包）。别换成不带 full 的 tex-chtml.js：
 *      那个版本遇到宏包外的命令会去临时下载 input/tex/extensions/xxx.js，本地没有就 404，
 *      整页公式会全部渲染失败。
 *    - 只注入 post（文章）和 page（独立页面），首页/归档/标签页不加载这 1.3MB 的文件。
 *
 * 2. 保护公式，免得被 markdown 自己吃掉（见下面的 filter）。
 */

const SCRIPT_PATH = 'js/mathjax/tex-chtml-full.js';

function scriptTag() {
  const root = hexo.config.root.endsWith('/') ? hexo.config.root : hexo.config.root + '/';
  return [
    '<script>',
    '  window.MathJax = {',
    '    tex: {',
    "      inlineMath: [['$', '$'], ['\\\\(', '\\\\)']],",
    "      displayMath: [['$$', '$$'], ['\\\\[', '\\\\]']],",
    '      processEscapes: true',
    '    },',
    '    options: {',
    // pre/code 里的 $ 不要当成公式（代码块里的美元符号不该被渲染）
    "      skipHtmlTags: ['script', 'noscript', 'style', 'textarea', 'pre', 'code'],",
    "      ignoreHtmlClass: 'no-mathjax'",
    '    }',
    '  };',
    '</script>',
    '<script defer src="' + root + SCRIPT_PATH + '"></script>'
  ].join('\n');
}

['post', 'page'].forEach(function(layout) {
  hexo.extend.injector.register('body_end', scriptTag, layout);
});

/*
 * 保护公式，免得被 markdown 自己吃掉。
 *
 * markdown 会把反斜杠+标点当成转义符，于是公式里的
 *     \{f_n\}  变成  {f_n}     （集合的大括号直接消失，MathJax 不报错，静默排错）
 *     \|dz\|   变成  |dz|      （范数的双竖线变成单竖线）
 * 另外 $m^*(B)$ 里的 * 会被当成斜体标记，把公式从中间劈成两块，公式就渲染不出来了。
 *
 * 办法：把公式内容里的这些字符换成 HTML 实体（\ 变 &#92; 等）。markdown 不认识实体，原样放过；
 * 浏览器解析时会解码回原字符，MathJax 拿到的还是原汁原味的 TeX。
 * 顺带把公式内部的换行压成空格，这样跨行写的公式也能被 MathJax 当成一个整体。
 */
const ESCAPE_MAP = {
  '\\': '&#92;',
  '*': '&#42;',
  '_': '&#95;',
  '`': '&#96;',
  '{': '&#123;',
  '}': '&#125;',
  '|': '&#124;',
  '~': '&#126;'
};

function protectMath(tex) {
  return tex
    .replace(/[\\*_`{}|~]/g, function(ch) { return ESCAPE_MAP[ch]; })
    .replace(/\s*\n\s*/g, ' ');
}

hexo.extend.filter.register('before_post_render', function(data) {
  if (!data.content || data.content.indexOf('$') === -1) return data;

  // 先把代码摘出去，免得动到里面的 $ 和反斜杠。
  // 除了 markdown 的代码块/行内代码，还要挡住已经生成好的 <pre>/<code>：
  // Hexo 内置的 backtick_code_block 过滤器（优先级 10）会把代码块连同内容一起换成 HTML，
  // 里面若有 $HOME 这种美元符号，就会跟正文公式错配，把真正的公式漏掉。
  const codes = [];
  let body = data.content.replace(
    /```[\s\S]*?```|~~~[\s\S]*?~~~|`[^`\n]*`|<pre[\s\S]*?<\/pre>|<code[\s\S]*?<\/code>/g,
    function(m) {
      codes.push(m);
      return '@@HEXO_MATH_CODE_' + (codes.length - 1) + '@@';
    }
  );

  // $$...$$ 优先，再处理 $...$
  body = body.replace(/\$\$([\s\S]+?)\$\$/g, function(m, tex) {
    return '$$' + protectMath(tex) + '$$';
  });
  body = body.replace(/\$([^$]+?)\$/g, function(m, tex) {
    // 中间隔了空行的公式跨了段落，这里不动它（MathJax 也没法跨段落排版）
    if (/\n[ \t]*\n/.test(tex)) return m;
    return '$' + protectMath(tex) + '$';
  });

  data.content = body.replace(/@@HEXO_MATH_CODE_(\d+)@@/g, function(m, i) { return codes[i]; });
  return data;
}, 9);  // 优先级 9：要跑在 Hexo 内置的 backtick_code_block（优先级 10）前面，理由见上面代码块的处理
