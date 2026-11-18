// 第 2 批分包共用：调用、身份与开关、上传（经云函数中转）、分块下载、错误提示。
// 不缓存任何账本数据；本机只存表单草稿（各页面自己决定）。
const { call } = require("../../utils/api");

const ME_TTL = 60 * 1000;
/** 当前身份和开关：miniapp.me 决定是不是管理员，members.me 带回各功能开关（开关关着时字段不出现） */
function me(force) {
  const g = getApp().globalData;
  if (!force && g.b2me && Date.now() - g.b2me.at < ME_TTL) return Promise.resolve(g.b2me.value);
  return call("miniapp.me")
    .then((m) => {
      if (m.status !== "owner" && m.status !== "member") {
        wx.reLaunch({ url: "/pages/gate/index" });
        throw Object.assign(new Error("无权限"), { code: "NO_ACCESS" });
      }
      return call("members.me")
        .catch(() => ({}))
        .then((t) => {
          const value = {
            admin: m.status === "owner",
            name: m.name || t.name || "",
            uid: t.uid || "",
            ownerUid: t.ownerUid || "",
            expenses: !!t.expensesEnabled,
            invoices: !!t.invoiceEnabled,
            audit: !!t.auditEnabled,
            members: !!t.membersEnabled,
            colors: !!t.scheduleOwnerEnabled,
          };
          g.b2me = { at: Date.now(), value };
          return value;
        });
    });
}

/** 截屏/录屏时遮盖（安卓）；每个页面 onShow / onHide 调 */
function privacyShow() {
  if (wx.setVisualEffectOnCapture) wx.setVisualEffectOnCapture({ visualEffect: "hidden" });
}
function privacyHide() {
  if (wx.setVisualEffectOnCapture) wx.setVisualEffectOnCapture({ visualEffect: "none" });
}

/** 跑一个写操作：busy 防连点，失败写进 data.error，成功弹轻提示 */
function run(page, fn, okText) {
  if (page.data.busy) return Promise.resolve(null);
  page.setData({ busy: true, error: "" });
  return Promise.resolve()
    .then(fn)
    .then((r) => {
      page.setData({ busy: false });
      if (okText) wx.showToast({ title: okText, icon: "success" });
      return r;
    })
    .catch((e) => {
      page.setData({ busy: false, error: (e && e.message) || "云端操作未完成，请稍后重试" });
      return null;
    });
}

function confirm(title, content, confirmText) {
  return new Promise((resolve) =>
    wx.showModal({ title, content, confirmText: confirmText || "确定", confirmColor: "#B4532F", success: (r) => resolve(!!r.confirm), fail: () => resolve(false) }),
  );
}

/**
 * 上传一个文件：wx.cloud.CDN 把本机文件交给云函数，云函数下载后交给原来的上传调用（≤4MB）。
 * target：expenses.receipts.upload（报销凭证）或 invoices.files.upload（开票资料/发票原件）
 */
function upload(file, target, purpose) {
  return call("miniapp.files.relay", {
    target,
    name: file.name,
    ...(purpose ? { purpose } : {}),
    url: wx.cloud.CDN({ type: "filePath", filePath: file.path }),
  });
}

/** 从聊天选文件（PDF、Word、图片）；extension 不带点 */
function chooseFiles(count, extension) {
  return new Promise((resolve, reject) =>
    wx.chooseMessageFile({
      count,
      type: "file",
      extension,
      success: (r) => resolve(r.tempFiles.map((f) => ({ path: f.path, name: f.name, size: f.size }))),
      fail: (e) => (/cancel/.test((e && e.errMsg) || "") ? resolve([]) : reject(new Error("没能选到文件"))),
    }),
  );
}
/** 拍照或从相册选图 */
function choosePhotos(count) {
  return new Promise((resolve, reject) =>
    wx.chooseMedia({
      count,
      mediaType: ["image"],
      sourceType: ["album", "camera"],
      sizeType: ["compressed"],
      success: (r) =>
        resolve(
          r.tempFiles.map((f, i) => {
            const ext = (/\.(\w+)$/.exec(f.tempFilePath) || [, "jpg"])[1].toLowerCase();
            return { path: f.tempFilePath, name: `照片${i + 1}.${ext === "jpeg" ? "jpg" : ext}`, size: f.size };
          }),
        ),
      fail: (e) => (/cancel/.test((e && e.errMsg) || "") ? resolve([]) : reject(new Error("没能选到照片"))),
    }),
  );
}

const DOC_TYPES = { "application/pdf": "pdf", "application/msword": "doc", "application/vnd.openxmlformats-officedocument.wordprocessingml.document": "docx" };
/**
 * 分块下载一个附件到本机临时目录再打开：图片用预览，PDF/Word 用系统预览，其他（txt 等）提示发到聊天。
 * via：expenses.receipts.urls 或 invoices.files.urls（云端先按原来的权限确认你能看这条记录）
 */
function openAttachment(via, id, index, onProgress) {
  const fs = wx.getFileSystemManager();
  let path = "";
  const step = (offset) =>
    call("miniapp.files.chunk", { via, id, index, offset }).then((c) => {
      if (!path) {
        const ext = (/\.(\w{1,5})$/.exec(c.name || "") || [, DOC_TYPES[c.type] || (c.type || "").split("/")[1] || "bin"])[1];
        path = `${wx.env.USER_DATA_PATH}/b2-${Date.now()}.${ext.toLowerCase()}`;
        fs.writeFileSync(path, c.data, "base64");
      } else fs.appendFileSync(path, c.data, "base64");
      if (onProgress && c.size) onProgress(Math.round(((c.next || c.size) / c.size) * 100));
      return c.next === null || c.next === undefined ? c : step(c.next);
    });
  return step(0).then((c) => {
    if (/^image\//.test(c.type)) return new Promise((resolve) => wx.previewImage({ urls: [path], complete: () => resolve(path) }));
    if (DOC_TYPES[c.type])
      return new Promise((resolve, reject) =>
        wx.openDocument({ filePath: path, showMenu: true, success: () => resolve(path), fail: () => reject(new Error("这个文件没法在手机上预览")) }),
      );
    return { path, name: c.name, share: true };
  });
}

/** 分块生成销售明细 CSV，写进本机临时文件；之后在点击里调 wx.shareFileMessage 发到聊天 */
function buildCsv(filters, onProgress) {
  const fs = wx.getFileSystemManager();
  let path = "";
  let name = "";
  const step = (offset) =>
    call("miniapp.export.csv", { ...filters, offset }).then((c) => {
      if (!path) {
        name = c.name;
        path = `${wx.env.USER_DATA_PATH}/${Date.now()}-${c.name}`;
        fs.writeFileSync(path, c.text, "utf8");
      } else fs.appendFileSync(path, c.text, "utf8");
      if (onProgress && c.length) onProgress(Math.round(((c.next || c.length) / c.length) * 100));
      return c.next === null || c.next === undefined ? { path, name, rows: c.rows } : step(c.next);
    });
  return step(0);
}

module.exports = { call, me, run, confirm, upload, chooseFiles, choosePhotos, openAttachment, buildCsv, privacyShow, privacyHide };
