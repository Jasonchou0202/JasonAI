// 和云端 server/miniapp/gate.ts 同样的格式检查（云端会再查一次）
const NAME = /^[\u4e00-\u9fa5A-Za-z0-9·・ _-]{1,20}$/;
const PHONE = /^1\d{10}$/;
function checkApply(name, phone, agree) {
  if (!NAME.test((name || "").trim())) return "姓名请填 1～20 个字，不要带特殊符号";
  if (!PHONE.test((phone || "").trim())) return "手机号请填 11 位、1 开头";
  if (!agree) return "请先勾选「我知道手机号只用于管理员识别」";
  return "";
}
function normalizeCode(raw) {
  return (raw || "").replace(/[\s-]/g, "").toUpperCase();
}
module.exports = { checkApply, normalizeCode };
