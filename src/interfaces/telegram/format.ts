export const clip = (text: string, max = 3900) => text.length <= max ? text : `${text.slice(0, max - 30)}\n…сообщение сокращено`;
export const esc = (text: string) => text.replace(/[&<>]/g, x => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" }[x]!));
export function requestList(rows: Array<{ title: string; url: string; summary?: string }>) {
  if (!rows.length) return "Ничего не найдено. Возможно, нужно вручную пройти защиту/вход через rts_session_status.";
  return rows.slice(0, 20).map((r, i) => `${i + 1}. <a href="${esc(r.url)}">${esc(r.title || "Запрос")}</a>\n${esc((r.summary ?? "").slice(0, 260))}`).join("\n\n");
}
export function tenderList(rows: Array<{title:string;url:string;summary?:string;price?:number;deadlineAt?:string;daysLeft?:number;score?:number;customer?:string;warnings?:string[]}>) {
  if(!rows.length)return "По заданным фильтрам ничего не найдено.";
  return rows.slice(0,20).map((r,i)=>{const meta=[r.score!==undefined&&`оценка ${r.score}/100`,r.price!==undefined&&`${r.price.toLocaleString("ru-RU")} ₽`,r.daysLeft!==undefined&&`${r.daysLeft} дн.`,r.customer].filter(Boolean).join(" · ");return `${i+1}. <a href="${esc(r.url)}">${esc(r.title)}</a>\n${esc(meta)}${r.warnings?.length?`\n⚠️ ${esc(r.warnings.join("; "))}`:""}`;}).join("\n\n");
}
