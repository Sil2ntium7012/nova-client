// ============================================================================
// main.js 의 CHANGELOG 에서 "지금 package.json 버전"에 해당하는 항목을 뽑아
// GitHub 릴리스 본문(RELEASE_NOTES.md)으로 만들어 주는 스크립트.
//
// 24-122차: "앞으로는 태그에 알아서 없애게 하고 업뎃도 알아서 그 깃허브에 같이 써지게"
//  - 릴리스 노트를 비워두면 GitHub 이 그 자리에 깃 태그(annotated tag) 메시지를 대신
//    보여줘서, 옛날 태그에 붙어 있던 "pack: hisunlit 1.0.3" 같은 문구가 계속 남아 있었음.
//    이제 .github/workflows/release.yml 이 이 스크립트로 본문을 만들어 함께 올리므로
//    태그 메시지가 표시될 일이 없음(워크플로가 만드는 태그도 메시지 없는 lightweight 태그).
//
// 사용: node build/release-notes.js   ->  저장소 루트에 RELEASE_NOTES.md 생성
// ============================================================================
const fs = require("fs");
const path = require("path");

const root = path.join(__dirname, "..");
const pkg = JSON.parse(fs.readFileSync(path.join(root, "package.json"), "utf-8"));
const src = fs.readFileSync(path.join(root, "main.js"), "utf-8");

// main.js 는 electron 을 require 하므로 그냥 require 할 수 없음.
// CHANGELOG 배열 리터럴만 잘라내서 평가함(순수 데이터라 안전).
const MARK = "const CHANGELOG = [";
const start = src.indexOf(MARK);
if (start < 0) {
  console.error("main.js 에서 CHANGELOG 를 찾지 못했습니다");
  process.exit(1);
}
const end = src.indexOf("\n];", start);
if (end < 0) {
  console.error("CHANGELOG 의 끝(']；')을 찾지 못했습니다");
  process.exit(1);
}
const literal = src.slice(start + MARK.length - 1, end + 2); // "[" ~ "]"
let changelog;
try {
  changelog = new Function("return " + literal)();
} catch (err) {
  console.error("CHANGELOG 를 읽지 못했습니다: " + (err && err.message));
  process.exit(1);
}

// 같은 버전 항목을 찾고, 없으면 마지막(가장 최신) 항목을 씀
const entry =
  [...changelog].reverse().find((e) => String(e.version) === String(pkg.version)) ||
  changelog[changelog.length - 1];

if (!entry) {
  console.error("CHANGELOG 가 비어 있습니다");
  process.exit(1);
}
if (String(entry.version) !== String(pkg.version)) {
  console.warn(
    `[주의] package.json 은 ${pkg.version} 인데 CHANGELOG 최신 항목은 ${entry.version} 입니다. ` +
      "새 버전을 올릴 땐 CHANGELOG 에도 항목을 추가하세요."
  );
}

// "## 소제목" 항목은 구분 제목, 그 앞에 오는 줄들은 머리말 문단으로
const items = (entry.items || []).map(String);
const out = [];
let seenGroup = false;
for (const it of items) {
  if (it.startsWith("## ")) {
    out.push("", "### " + it.slice(3).trim(), "");
    seenGroup = true;
  } else if (!seenGroup) {
    out.push(it); // 머리말 (예: "Nova Client를 새롭게 시작합니다")
  } else {
    out.push("- " + it);
  }
}

const md = out.join("\n").replace(/\n{3,}/g, "\n\n").trim() + "\n";
const dest = path.join(root, "RELEASE_NOTES.md");
fs.writeFileSync(dest, md, "utf-8");
console.log(`RELEASE_NOTES.md 생성 완료 (v${entry.version}, 항목 ${items.length}개)`);
