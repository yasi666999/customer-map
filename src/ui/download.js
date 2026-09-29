/* 浏览器下载小工具
   ------------------------------------------------------------------
   项目里有三处"导出文件"：客户地址 CSV、地点字典 CSV、配置文件 JSON。
   原来每处都各写一遍 Blob + 隐藏 <a> 点击 + 回收 URL 的样板，
   收成一处之后，要改下载行为（比如加进度提示）只用改这里。 */

export function downloadBlob(blob, filename) {
  var url = URL.createObjectURL(blob);
  var a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  // 立刻 revoke 会让部分浏览器来不及取到内容，延后回收
  setTimeout(function () { URL.revokeObjectURL(url); }, 2000);
}

export function downloadText(text, filename, mime) {
  downloadBlob(new Blob([text], { type: mime || 'text/csv;charset=utf-8' }), filename);
}

/** 文件名里的日期后缀：2026-09-22 */
export function todayStamp(d) {
  return (d || new Date()).toISOString().slice(0, 10);
}
