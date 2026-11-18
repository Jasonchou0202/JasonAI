// 草稿只存本机（断网也不丢）；账本数据不落盘
function read(key) {
  try {
    const v = wx.getStorageSync(key);
    return v && typeof v === "object" ? v : null;
  } catch (e) {
    return null;
  }
}
function write(key, value) {
  try {
    wx.setStorageSync(key, value);
  } catch (e) {}
}
function remove(key) {
  try {
    wx.removeStorageSync(key);
  } catch (e) {}
}
module.exports = { read, write, remove };
