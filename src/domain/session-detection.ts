export type SessionEvidence = { body: string; controls?: string; hasPassword?: boolean };

export function assessRtsSession(evidence: SessionEvidence) {
  const body = evidence.body.replace(/\s+/g, " ").toLowerCase();
  const controls = (evidence.controls ?? "").replace(/\s+/g, " ").toLowerCase();
  const all = `${body} ${controls}`;
  const signals: string[] = [];
  let score = 0;
  if (/(?:выйти|выход|\blogout\b|\bsign\s*out\b)/i.test(controls)) { score += 8; signals.push("logout"); }
  if (/продавец\s*\/\s*покупатель(?:\s*\([^)]*\))?/i.test(body)) { score += 5; signals.push("account-role"); }
  if (/мои\s+(поиски|закупки|заявки|предложения|заказы|договоры)/i.test(body)) { score += 4; signals.push("personal-section"); }
  if (/(профиль организации|настройки профиля|личные сообщения)/i.test(body)) { score += 4; signals.push("profile-section"); }
  if (/личный кабинет/i.test(all)) { score += 2; signals.push("cabinet"); }
  const loginControl = /(войти|вход|авторизация|зарегистрироваться)/i.test(controls);
  if (evidence.hasPassword) score -= 8;
  if (loginControl && !signals.some(signal => ["logout", "account-role", "personal-section", "profile-section"].includes(signal))) score -= 3;
  return { likelyLoggedIn: score >= 4, score, signals };
}
