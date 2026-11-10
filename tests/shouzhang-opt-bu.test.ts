import { describe, expect, it } from "vitest";
import { findCustomerByName, scheduleText } from "../src/domain/entryHelpers";
import { displayCustomerName } from "../src/domain/customers";

// 11-10 补充：记一笔顺手建日程的有效动作写法，与「新增跟进日程」弹窗一致
describe("scheduleText", () => {
  const a = "【老客老品】核心客户维护好，持续赋能，增加粘度";
  const b = "【老客新品】沟通了解新需求";
  it("没选动作：标题默认「续费提醒：商品名」，没有商品时「客户回访」", () => {
    expect(scheduleText("", " Pro 5x ", [])).toEqual({
      title: "续费提醒：Pro 5x",
      nextAction: "",
    });
    expect(scheduleText("  ", "", [])).toEqual({
      title: "客户回访",
      nextAction: "",
    });
  });
  it("选了动作、没手填标题：第一条做标题，其余逐行进下一步", () => {
    expect(scheduleText("", "Pro 5x", [a])).toEqual({
      title: a,
      nextAction: "",
    });
    expect(scheduleText("", "Pro 5x", [a, b])).toEqual({
      title: a,
      nextAction: b,
    });
  });
  it("手填了标题：动作全部进下一步", () => {
    expect(scheduleText(" 年费沟通 ", "Pro 5x", [a, b])).toEqual({
      title: "年费沟通",
      nextAction: `${a}\n${b}`,
    });
  });
  it("长度截断：标题 200 字、下一步 2000 字", () => {
    const long = "字".repeat(300);
    expect(scheduleText("", "", [long]).title).toHaveLength(200);
    expect(scheduleText("x", "", Array(20).fill(long)).nextAction).toHaveLength(
      2000,
    );
  });
});

describe("findCustomerByName", () => {
  const list = [
    { id: "root", name: "✅李德嘉63.124.162.53", mergedInto: null },
    { id: "alias", name: "✅李德嘉", mergedInto: "root" },
    { id: "llt", name: "李蓝天", mergedInto: null },
  ];
  it("精确同名优先，其次按显示名找未合并的主档", () => {
    expect(findCustomerByName(list, "李蓝天", displayCustomerName)?.id).toBe(
      "llt",
    );
    expect(findCustomerByName(list, " 李德嘉 ", displayCustomerName)?.id).toBe(
      "root",
    );
    expect(findCustomerByName(list, "✅李德嘉", displayCustomerName)?.id).toBe(
      "alias",
    );
  });
  it("空名或没有这位客户时返回空", () => {
    expect(findCustomerByName(list, "  ", displayCustomerName)).toBeUndefined();
    expect(
      findCustomerByName(list, "新客户", displayCustomerName),
    ).toBeUndefined();
  });
});
