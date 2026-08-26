export type BrowserAction = "click" | "fill" | "select";
export type ActionTarget = { tag?: string; type?: string; text?: string; ariaLabel?: string; name?: string; id?: string; value?: string; formText?: string };

const FINAL_ACTION = /подпис|отправ(?:ить|ка)|подать|опубликов|заключ|акцепт|сделать\s+ставк|участвоват|подтвердить\s+(?:заявк|предлож|контракт)|выигр|\bsubmit\b|\bsign\b|\bpublish\b|place\s+bid|accept\s+contract/i;
const SECRET_FIELD = /парол|password|пин|\bpin\b|captcha|капч|смс|sms|одноразов|секрет|токен|электронн.*подпис|сертификат/i;

export function assertSafeBrowserAction(action: BrowserAction, target: ActionTarget) {
  const type = (target.type ?? "").toLowerCase();
  const descriptor = [target.text, target.ariaLabel, target.name, target.id, target.value, target.formText].filter(Boolean).join(" ").slice(0, 4_000);
  if (action === "click" && (type === "submit" || FINAL_ACTION.test(descriptor))) throw new Error("FINAL_ACTION_FORBIDDEN: подписание, публикация, отправка заявки и ставки выполняются только пользователем вручную на площадке");
  if ((action === "fill" || action === "select") && (type === "password" || type === "file" || SECRET_FIELD.test(descriptor))) throw new Error("SECRET_INPUT_FORBIDDEN: мост не вводит пароли, коды, CAPTCHA, сертификаты и файлы подписи");
}
