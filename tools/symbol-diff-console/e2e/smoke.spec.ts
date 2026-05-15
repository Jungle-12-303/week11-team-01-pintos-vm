import { expect, test } from "@playwright/test";
import { createSymbolDiffFixtureRepo } from "../src/test/fixtureRepo";

test("compares refs, persists a decision note, and unlocks PR body", async ({ page }) => {
  const repo = createSymbolDiffFixtureRepo({ singleSymbol: true });

  await page.goto("/");
  await page.evaluate(() => localStorage.clear());
  await page.getByTestId("repo-input").fill(repo.path);
  await page.getByTestId("load-branches-button").click();
  await expect(page.getByTestId("left-branch-select")).toBeEnabled();
  await page.getByTestId("left-branch-select").selectOption(repo.leftRef);
  await page.getByTestId("right-branch-select").selectOption(repo.rightRef);
  await page.getByTestId("target-branch-select").selectOption(repo.targetRef);
  await page.getByTestId("compare-button").click();

  await expect(page.getByTestId("symbol-load_segment")).toBeVisible();
  await expect(page.getByText("남은 결정 1개")).toBeVisible();
  await page.getByRole("button", { name: "오른쪽 채택" }).click();
  await page.getByLabel("리뷰 메모").fill("오른쪽 offset 변경을 채택합니다.");
  await Promise.all([
    page.waitForResponse((response) => response.url().includes("/decisions/") && response.request().method() === "PATCH"),
    page.getByLabel("리뷰 메모").blur()
  ]);
  await expect(page.getByRole("button", { name: "모든 결정 완료 · PR 본문 복사 가능" })).toBeVisible();

  await page.reload();
  await expect(page.getByTestId("symbol-load_segment")).toBeVisible();
  await expect(page.getByLabel("리뷰 메모")).toHaveValue("오른쪽 offset 변경을 채택합니다.");
  await expect(page.getByRole("button", { name: "모든 결정 완료 · PR 본문 복사 가능" })).toBeVisible();
});
