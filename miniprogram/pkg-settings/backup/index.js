// 保存完整备份 / 从备份恢复到空账本（方案对照表 10b）。备份发到聊天；恢复从聊天选文件，二次确认，只给管理员
const lib = require("../lib/settings-lib.js");
const { call, bigField, whoAmI } = require("../../utils/b3");
let picked = null; // 只放内存
Page({
  data: { busy: "", status: "", percent: 0, exported: "", restored: "", backup: null, error: "" },
  onLoad() {
    whoAmI().then((me) => !me.admin && wx.redirectTo({ url: "/pkg-settings/index/index" })).catch(() => {});
  },
  onUnload() {
    picked = null;
  },
  exportBackup() {
    this.setData({ busy: "export", error: "", exported: "" });
    call("miniapp.backup.export")
      .then((r) => {
        const text = lib.gunzipBase64(r.gz);
        lib.readBackupText(text); // 发出去之前再校验一遍格式
        const name = lib.backupFileName(r.exportedAt);
        const path = `${wx.env.USER_DATA_PATH}/${name}`;
        const fs = wx.getFileSystemManager();
        fs.writeFileSync(path, text, "utf8");
        const cleanup = () => {
          try {
            fs.unlinkSync(path);
          } catch (e) {}
        };
        wx.shareFileMessage({
          filePath: path,
          fileName: name,
          success: () => this.setData({ exported: "备份已发出，请在聊天里保存好" }),
          fail: () => this.setData({ error: "没有发出去；可以再点一次" }),
          complete: () => {
            cleanup();
            this.setData({ busy: "" });
          },
        });
      })
      .catch((e) => this.setData({ busy: "", error: e.message }));
  },
  pick() {
    wx.chooseMessageFile({
      count: 1,
      type: "file",
      extension: ["json"],
      success: (r) => {
        const f = r.tempFiles[0];
        if (f.size > lib.BACKUP_MAX_BYTES) return this.setData({ error: "备份文件过大" });
        wx.getFileSystemManager().readFile({
          filePath: f.path,
          encoding: "utf8",
          success: (res) => {
            try {
              const b = lib.readBackupText(res.data);
              picked = { text: JSON.stringify(b), count: b.sales.length };
              this.setData({
                error: "",
                restored: "",
                backup: {
                  fileName: f.name,
                  exportedAt: String(b.exportedAt).slice(0, 16).replace("T", " "),
                  sales: b.sales.length,
                  products: b.products.length,
                  customers: b.version === 2 ? b.customers.length : 0,
                  tasks: b.version === 2 ? b.tasks.length : 0,
                },
              });
            } catch (e) {
              this.setData({ error: e.message || "这不是生意手账的备份文件" });
            }
          },
          fail: () => this.setData({ error: "文件读不出来，请重新选" }),
        });
      },
    });
  },
  clearPick() {
    picked = null;
    this.setData({ backup: null });
  },
  restore() {
    if (!picked || this.data.busy) return;
    wx.showModal({
      title: "恢复到空账本",
      content: `恢复 ${picked.count} 条销售记录。只能恢复到空账本，现有记录不会被覆盖。确定吗？`,
      confirmText: "确定恢复",
      confirmColor: "#D97757",
      success: (m) => {
        if (!m.confirm) return;
        const body = bigField(lib.gzipBase64(picked.text), "backupGz", "backupUrl");
        this.setData({ busy: "restore", status: "正在恢复…", percent: 0, error: "" });
        const step = () =>
          call("miniapp.backup.restore", body).then((r) => {
            const n = r.processed == null ? r.count : r.processed;
            this.setData({ status: `已恢复 ${n} / ${picked.count} 条`, percent: picked.count ? Math.round((n / picked.count) * 100) : 100 });
            return r.done === false ? step() : r;
          });
        step()
          .then((r) => {
            picked = null;
            this.setData({ busy: "", backup: null, restored: `已恢复 ${r.count} 条记录` });
          })
          .catch((e) => this.setData({ busy: "", error: e.message }));
      },
    });
  },
});
