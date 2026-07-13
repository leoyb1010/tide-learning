#!/usr/bin/env bash
# ============================================================================
# 契约冒烟（流3-U6 · 契约防断裂制度）
# ----------------------------------------------------------------------------
# 目的：iOS/Mac 客户端消费 ~42 个后端端点，其 DTO 里有一批「非 Optional 字段」。
#       一旦后端悄悄改名/删字段/改类型，Swift 解码会整屏崩，且 CI 不报。
#       本脚本以真实 HTTP 响应为准，守住高危 DTO 的形状 + ok 信封 + 日期可解析。
#
# 特性：
#   - 只读为主；唯一的写操作（POST /api/notes 验 tags）会立即 DELETE 清理，
#     不留脏数据，可重复运行。
#   - 动态 id 从列表接口现取（courses / notes / market / demands）。
#   - 每个端点：HTTP 200 && ok==true && 高危字段存在且类型正确 && 日期 ISO8601 可解析。
#   - 任一失败 → echo FAIL + 端点 + 缺失/类型错误字段，脚本非零退出。
#   - 全过 → echo「契约冒烟 N/N 通过」。
#
# 用法：bash scripts/contract-smoke.sh   （需生产服务器在 http://localhost:3100 运行）
# ============================================================================
set -euo pipefail

export PATH="/usr/bin:/bin:/usr/local/bin:/opt/homebrew/bin:${PATH:-}"

BASE="${BASE:-http://localhost:3100}"
CT="Content-Type: application/json"

pyc() { python3 "$@"; }

# --- 依赖探活 ---------------------------------------------------------------
command -v curl >/dev/null 2>&1 || { echo "FAIL 前置 · 缺少 curl"; exit 2; }
command -v python3 >/dev/null 2>&1 || { echo "FAIL 前置 · 缺少 python3"; exit 2; }

# 服务器探活（连不上直接给清晰信号，别让后面每个 curl 都超时）
if ! curl -sf -o /dev/null "$BASE/api/pricing" 2>/dev/null; then
  # pricing 可能需要鉴权，用更基础的探活：只要能连上并返回任意 HTTP 状态即可
  if ! curl -s -o /dev/null -w '%{http_code}' "$BASE/api/auth/login" 2>/dev/null | grep -qE '^[0-9]'; then
    echo "FAIL 前置 · 无法连接 $BASE（生产服务器是否在 3100 运行？）"
    exit 2
  fi
fi

# --- 登录拿 token -----------------------------------------------------------
LOGIN_RESP="$(curl -s -X POST "$BASE/api/auth/login" -H "$CT" \
  -d '{"identifier":"demo@tide.learning","password":"demo123"}')"

TOKEN="$(printf '%s' "$LOGIN_RESP" | pyc -c '
import sys, json
try:
    d = json.load(sys.stdin)
except Exception as e:
    print("", end=""); sys.exit(0)
print((d.get("data") or {}).get("sessionToken", ""), end="")
')"

if [ -z "$TOKEN" ]; then
  echo "FAIL 登录 · POST /api/auth/login 未返回 sessionToken"
  echo "  响应：$(printf '%s' "$LOGIN_RESP" | head -c 200)"
  exit 1
fi
AUTH="Authorization: Bearer $TOKEN"

# 计数器
PASS=0
FAILED=0
declare -a FAIL_MSGS=()

# --- 自愈：清扫历史遗留的探针笔记 ------------------------------------------
# 若上一轮因网络抖动 DELETE 失败留下 __contract_smoke_probe__ 笔记，这里先扫掉，
# 确保「可重复运行、不建脏数据」——多跑几次也不会累积。
sweep_probe_notes() {
  local ids
  ids="$(curl -s "$BASE/api/notes" -H "$AUTH" | pyc -c '
import sys, json
try:
    notes = json.load(sys.stdin)["data"]["notes"]
except Exception:
    notes = []
for n in notes:
    if "__contract_smoke_probe__" in (n.get("contentMd") or ""):
        print(n["id"])
')"
  local id
  for id in $ids; do
    curl -s -o /dev/null -X DELETE "$BASE/api/notes/$id" -H "$AUTH" || true
  done
}
sweep_probe_notes

# ----------------------------------------------------------------------------
# assert_dto <label> <path> <spec-json>
#   spec-json：断言规格，交给内嵌 python3 校验。字段规格用「点路径」定位，
#   支持 list-of-dict 用 "[0]" 取首元素。
#   规格结构：{ "root": "data.xxx", "list": bool, "fields": {"路径":"类型"}, "dates": [...] }
#   类型：str/int/float/number/bool/list/dict/str?/... （? 后缀允许 null）
# ----------------------------------------------------------------------------
assert_dto() {
  local label="$1" path="$2" spec="$3"
  local body http
  # 一次 curl 同时拿 body 与 http code
  local tmp; tmp="$(curl -s -w $'\n__HTTP__%{http_code}' "$BASE$path" -H "$AUTH")"
  http="${tmp##*__HTTP__}"
  body="${tmp%$'\n'__HTTP__*}"

  local out
  out="$(SPEC="$spec" HTTP="$http" LABEL="$label" PATHV="$path" BODY="$body" pyc <<'PY'
import sys, os, json, re
from datetime import datetime, timezone

spec = json.loads(os.environ["SPEC"])
http = os.environ["HTTP"]
label = os.environ["LABEL"]
pathv = os.environ["PATHV"]
body = os.environ["BODY"]

errs = []

# (a) HTTP 200
if http != "200":
    errs.append(f"HTTP {http}（期望 200）")

# 解析信封
try:
    env = json.loads(body)
except Exception:
    print("FAIL::" + "; ".join(errs + ["响应非 JSON: " + body[:120]]))
    sys.exit(0)

if env.get("ok") is not True:
    errs.append(f"ok!={env.get('ok')} error={env.get('error')!r}")

data = env.get("data")

def resolve(obj, dotted):
    """按点路径取值；'[0]' 取 list 首元素。返回 (found, value)。"""
    cur = obj
    if dotted in ("", "data"):
        return True, cur
    for seg in dotted.split("."):
        if seg == "":
            continue
        m = re.match(r"^(.*?)\[(\d+)\]$", seg)
        if m:
            key, idx = m.group(1), int(m.group(2))
            if key:
                if not isinstance(cur, dict) or key not in cur:
                    return False, None
                cur = cur[key]
            if not isinstance(cur, list):
                return False, None
            if len(cur) <= idx:
                # 空列表：无法校验元素形状；视为「跳过元素级断言」而非失败
                return None, None
            cur = cur[idx]
        else:
            if not isinstance(cur, dict) or seg not in cur:
                return False, None
            cur = cur[seg]
    return True, cur

TYPE_CHECK = {
    "str": lambda v: isinstance(v, str),
    "int": lambda v: isinstance(v, int) and not isinstance(v, bool),
    "float": lambda v: isinstance(v, (int, float)) and not isinstance(v, bool),
    "number": lambda v: isinstance(v, (int, float)) and not isinstance(v, bool),
    "bool": lambda v: isinstance(v, bool),
    "list": lambda v: isinstance(v, list),
    "dict": lambda v: isinstance(v, dict),
}

root = spec.get("root", "data")
# root 相对 data；spec 里写 "data.xxx" 或 "xxx" 都行
root_norm = root[5:] if root.startswith("data.") else ("" if root == "data" else root)

found, base = resolve(data, root_norm)
if found is False:
    errs.append(f"根路径缺失: {root}")
    print("FAIL::" + "; ".join(errs))
    sys.exit(0)
if found is None:
    # 根是空列表元素 → 该端点当前无数据，跳过字段级断言但仍认为契约「未违反」
    print("SKIP_EMPTY")
    sys.exit(0)

fields = spec.get("fields", {})
for fpath, ftype in fields.items():
    optional = ftype.endswith("?")
    base_type = ftype[:-1] if optional else ftype
    fnd, val = resolve(base, fpath)
    if fnd is None:
        # 中途遇空列表，跳过该字段
        continue
    if fnd is False:
        errs.append(f"缺失字段 {fpath}:{ftype}")
        continue
    if val is None:
        if not optional:
            errs.append(f"字段 {fpath} 为 null（非 Optional）")
        continue
    checker = TYPE_CHECK.get(base_type)
    if checker and not checker(val):
        errs.append(f"字段 {fpath} 类型错误：期望 {base_type}，实为 {type(val).__name__}")

# (c) 日期字段 ISO8601 可解析
for dpath in spec.get("dates", []):
    fnd, val = resolve(base, dpath)
    if fnd is None:
        continue
    if fnd is False:
        errs.append(f"缺失日期字段 {dpath}")
        continue
    if val is None:
        continue  # 可空日期允许 null
    s = val.replace("Z", "+00:00") if isinstance(val, str) else val
    try:
        datetime.fromisoformat(s)
    except Exception:
        errs.append(f"日期 {dpath} 无法按 ISO8601 解析：{val!r}")

if errs:
    print("FAIL::" + "; ".join(errs))
else:
    print("OK")
PY
)"

  if [ "$out" = "OK" ] || [ "$out" = "SKIP_EMPTY" ]; then
    PASS=$((PASS + 1))
    if [ "$out" = "SKIP_EMPTY" ]; then
      printf '  ok   %-42s %s\n' "$label" "(空数据，跳过元素断言)"
    else
      printf '  ok   %-42s\n' "$label"
    fi
  else
    FAILED=$((FAILED + 1))
    local reason="${out#FAIL::}"
    FAIL_MSGS+=("FAIL  $label  [$path]  $reason")
    printf '  FAIL %-42s %s\n' "$label" "$reason"
  fi
}

echo "契约冒烟开始 · $BASE"
echo "----------------------------------------------------------------------"

# --- 动态取 id --------------------------------------------------------------
COURSE_ID="$(curl -s "$BASE/api/courses" -H "$AUTH" | pyc -c '
import sys,json
try: d=json.load(sys.stdin)["data"]["courses"]
except Exception: d=[]
print(d[0]["id"] if d else "", end="")
')"
LESSON_ID="$(curl -s "$BASE/api/desk" -H "$AUTH" | pyc -c '
import sys,json
try:
    rl=json.load(sys.stdin)["data"]["resumeList"]
    print(rl[0]["lessonId"] if rl else "", end="")
except Exception: print("", end="")
')"
# 若 desk 无 resume，退回从课程首讲取
if [ -z "$LESSON_ID" ] && [ -n "$COURSE_ID" ]; then
  LESSON_ID="$(curl -s "$BASE/api/courses/$COURSE_ID" -H "$AUTH" | pyc -c '
import sys,json
try:
    ls=json.load(sys.stdin)["data"]["course"]["lessons"]
    print(ls[0]["id"] if ls else "", end="")
except Exception: print("", end="")
')"
fi

# ============================================================================
# 高危 DTO 断言（字段名以真实响应为准，均已 curl 核对过）
# ============================================================================

# --- 1) LessonAggregate: GET /api/lessons/[id] ---
# 非 Optional: access:Bool, course{id,title}, lesson{id,title,contentType,durationSec,isFree}, outline:[]
if [ -n "$LESSON_ID" ]; then
  assert_dto "LessonAggregate" "/api/lessons/$LESSON_ID" '{
    "root":"data",
    "fields":{
      "access":"bool",
      "course":"dict",
      "course.id":"str","course.title":"str",
      "lesson":"dict",
      "lesson.id":"str","lesson.title":"str","lesson.contentType":"str",
      "lesson.durationSec":"int","lesson.isFree":"bool",
      "outline":"list",
      "outline[0].id":"str","outline[0].title":"str","outline[0].isFree":"bool","outline[0].durationSec":"int"
    }
  }'
else
  FAILED=$((FAILED+1)); FAIL_MSGS+=("FAIL  LessonAggregate  无可用 lessonId（desk/courses 均空）")
  printf '  FAIL %-42s %s\n' "LessonAggregate" "无可用 lessonId"
fi

# --- 2) MarketStall: GET /api/market items[] ---
# 非 Optional: id,title,collectCount,learnersCount,isPaid,salesCount,collectedByMe,mine,seller{id,nickname}; priceCredits 可 null
assert_dto "MarketStall" "/api/market" '{
  "root":"data",
  "fields":{
    "items":"list",
    "items[0].id":"str","items[0].title":"str",
    "items[0].collectCount":"int","items[0].learnersCount":"int",
    "items[0].priceCredits":"int?",
    "items[0].isPaid":"bool","items[0].salesCount":"int",
    "items[0].collectedByMe":"bool","items[0].mine":"bool",
    "items[0].seller":"dict",
    "items[0].seller.id":"str","items[0].seller.nickname":"str"
  }
}'

# --- 3) ShelfCourse: GET /api/shelf ---
# 数据在 shelf.<bucket>[]；取有数据的 ai_created 桶断言
# 非 Optional: id,slug,title,category,categoryLabel,lessonsCount,origin,progress,coverSrc
assert_dto "ShelfCourse" "/api/shelf" '{
  "root":"data.shelf",
  "fields":{
    "ai_created":"list",
    "ai_created[0].id":"str","ai_created[0].slug":"str","ai_created[0].title":"str",
    "ai_created[0].category":"str","ai_created[0].categoryLabel":"str",
    "ai_created[0].lessonsCount":"int","ai_created[0].origin":"str",
    "ai_created[0].progress":"int","ai_created[0].coverSrc":"str"
  }
}'

# --- 4) DeskData: GET /api/desk ---
# 非 Optional: litToday, streak, recentNotes:[], myCourseCount, dueReviewCount
assert_dto "DeskData" "/api/desk" '{
  "root":"data",
  "fields":{
    "greeting":"str","nickname":"str","advice":"str",
    "litToday":"bool","streak":"int",
    "resumeList":"list",
    "resumeList[0].courseSlug":"str","resumeList[0].courseTitle":"str",
    "resumeList[0].lessonId":"str","resumeList[0].lessonTitle":"str",
    "resumeList[0].progressPct":"int","resumeList[0].remainText":"str",
    "recentNotes":"list",
    "recentNotes[0].id":"str","recentNotes[0].title":"str","recentNotes[0].relativeTime":"str",
    "myCourseCount":"int","dueReviewCount":"int"
  }
}'

# --- 5) Note: GET /api/notes ---
# 非 Optional: id,createdAt,updatedAt,source,kind,pinned,tags:[]
assert_dto "Note(GET list)" "/api/notes" '{
  "root":"data",
  "fields":{
    "notes":"list",
    "notes[0].id":"str","notes[0].source":"str","notes[0].kind":"str",
    "notes[0].pinned":"bool","notes[0].tags":"list"
  },
  "dates":["notes[0].createdAt","notes[0].updatedAt"]
}'

# ============================================================================
# 其余覆盖端点（信封 + 关键字段 + 日期）
# ============================================================================

# auth/me
assert_dto "auth/me" "/api/auth/me" '{
  "root":"data",
  "fields":{
    "user":"dict","user.id":"str","user.nickname":"str","user.role":"str",
    "entitlement":"dict","entitlement.isSubscriber":"bool","entitlement.accessLevel":"str"
  },
  "dates":["entitlement.validUntil"]
}'

# credits/me
assert_dto "credits/me" "/api/credits/me" '{
  "root":"data",
  "fields":{
    "balance":"int","recentLedger":"list",
    "recentLedger[0].delta":"int","recentLedger[0].type":"str","recentLedger[0].balanceAfter":"int"
  },
  "dates":["recentLedger[0].createdAt"]
}'

# entitlement/me
assert_dto "entitlement/me" "/api/entitlement/me" '{
  "root":"data",
  "fields":{
    "isSubscriber":"bool","accessLevel":"str","subscriptionStatus":"str",
    "canVote":"bool","canUseLLM":"bool","noteFreeLimit":"int","monthlyGrant":"int"
  },
  "dates":["validUntil"]
}'

# me/overview（v3.2 成长档案聚合，iOS/Mac 消费）
assert_dto "me/overview" "/api/me/overview" '{
  "root":"data",
  "fields":{
    "totalStudySec":"int","completedCount":"int","notesCount":"int","notebookCount":"int",
    "purchasedCount":"int","dueReviewCount":"int","currentStreak":"int","longestStreak":"int",
    "achievementsCount":"int","creditBalance":"int","isSubscriber":"bool","statusLabel":"str",
    "subscriptionStatus":"str",
    "creator":"dict","creator.totalIncome":"int","creator.totalSales":"int","creator.stallCount":"int"
  },
  "dates":["validUntil"]
}'

# me/gamification（成长档案：连续天数/日历/成就，iOS ProfileView 强解码；P2-12 补覆盖）
assert_dto "me/gamification" "/api/me/gamification" '{
  "root":"data",
  "fields":{
    "currentStreak":"int","longestStreak":"int",
    "calendar":"list","calendar[0].day":"str","calendar[0].minutes":"int",
    "achievements":"list","achievements[0].key":"str","achievements[0].name":"str"
  }
}'

# notifications（通知列表：iOS NotificationsView 强解码；P2-12 补覆盖）
assert_dto "notifications" "/api/notifications" '{
  "root":"data",
  "fields":{
    "unread":"int","items":"list",
    "items[0].id":"str","items[0].type":"str","items[0].title":"str","items[0].read":"bool"
  },
  "dates":["items[0].createdAt"]
}'

# subscription/me
assert_dto "subscription/me" "/api/subscription/me" '{
  "root":"data",
  "fields":{
    "subscription":"dict",
    "subscription.id":"str","subscription.userId":"str","subscription.status":"str",
    "subscription.plan":"dict","subscription.plan.name":"str","subscription.plan.priceCents":"int",
    "entitlement":"dict","entitlement.isSubscriber":"bool"
  },
  "dates":["subscription.currentPeriodStart","subscription.currentPeriodEnd"]
}'

# pricing
assert_dto "pricing" "/api/pricing" '{
  "root":"data",
  "fields":{
    "plans":"list",
    "plans[0].id":"str","plans[0].name":"str","plans[0].billingPeriod":"str",
    "plans[0].priceCents":"int","plans[0].currency":"str","plans[0].isActive":"bool"
  }
}'

# notebooks
assert_dto "notebooks" "/api/notebooks" '{
  "root":"data",
  "fields":{
    "notebooks":"list",
    "notebooks[0].id":"str","notebooks[0].title":"str","notebooks[0].noteCount":"int"
  },
  "dates":["notebooks[0].updatedAt"]
}'

# notes/compose-options
assert_dto "notes/compose-options" "/api/notes/compose-options" '{
  "root":"data",
  "fields":{
    "notebooks":"list","tags":"list","courses":"list",
    "tags[0].id":"str","tags[0].name":"str",
    "courses[0].id":"str","courses[0].slug":"str","courses[0].title":"str"
  }
}'

# posts
assert_dto "posts" "/api/posts" '{
  "root":"data",
  "fields":{
    "posts":"list",
    "posts[0].id":"str","posts[0].type":"str","posts[0].content":"str",
    "posts[0].likeCount":"int","posts[0].commentCount":"int",
    "posts[0].author":"dict","posts[0].author.id":"str","posts[0].author.nickname":"str",
    "posts[0].likedByMe":"bool"
  },
  "dates":["posts[0].createdAt"]
}'

# demands
assert_dto "demands" "/api/demands" '{
  "root":"data",
  "fields":{
    "demands":"list",
    "demands[0].id":"str","demands[0].title":"str","demands[0].category":"str",
    "demands[0].categoryLabel":"str","demands[0].status":"str","demands[0].totalVotes":"int",
    "demands[0].commentCount":"int"
  }
}'

# courses list
assert_dto "courses(list)" "/api/courses" '{
  "root":"data",
  "fields":{
    "courses":"list",
    "courses[0].id":"str","courses[0].slug":"str","courses[0].title":"str",
    "courses[0].category":"str","courses[0].lessonsCount":"int","courses[0].learnersCount":"int"
  },
  "dates":["courses[0].lastUpdatedAt"]
}'

# course detail
if [ -n "$COURSE_ID" ]; then
  assert_dto "course(detail)" "/api/courses/$COURSE_ID" '{
    "root":"data",
    "fields":{
      "course":"dict","course.id":"str","course.slug":"str","course.title":"str",
      "categoryLabel":"str","levelLabel":"str","durationText":"str",
      "lessons":"list","lessons[0].id":"str","lessons[0].title":"str",
      "lessons[0].contentType":"str","lessons[0].durationSec":"int",
      "lessons[0].isFree":"bool","lessons[0].canAccess":"bool"
    },
    "dates":["course.lastUpdatedAt"]
  }'
else
  FAILED=$((FAILED+1)); FAIL_MSGS+=("FAIL  course(detail)  无可用 courseId")
  printf '  FAIL %-42s %s\n' "course(detail)" "无可用 courseId"
fi

# reviews（课程评价聚合，取 course id）
if [ -n "$COURSE_ID" ]; then
  assert_dto "reviews" "/api/courses/$COURSE_ID/reviews" '{
    "root":"data",
    "fields":{
      "aggregate":"dict","aggregate.score":"number","aggregate.count":"int",
      "aggregate.isPlaceholder":"bool","aggregate.dist":"list",
      "reviews":"list","canReview":"bool"
    }
  }'
else
  FAILED=$((FAILED+1)); FAIL_MSGS+=("FAIL  reviews  无可用 courseId")
  printf '  FAIL %-42s %s\n' "reviews" "无可用 courseId"
fi

# ============================================================================
# 写-读-删闭环：POST /api/notes 响应必须含 tags（本轮已修，冒烟守住），随后 DELETE 清理
# ============================================================================
echo "----------------------------------------------------------------------"
NOTE_CREATE="$(curl -s -X POST "$BASE/api/notes" -H "$AUTH" -H "$CT" \
  -d '{"contentMd":"__contract_smoke_probe__","source":"manual","kind":"text"}')"

NOTE_CHECK="$(NOTE_BODY="$NOTE_CREATE" pyc <<'PY'
import os, json
try:
    d = json.loads(os.environ["NOTE_BODY"])
except Exception:
    print("FAIL::POST 响应非 JSON"); raise SystemExit(0)
if d.get("ok") is not True:
    print("FAIL::POST ok=%r error=%r" % (d.get("ok"), d.get("error"))); raise SystemExit(0)
note = d.get("data") or {}
errs = []
for f in ("id","source","kind"):
    if not isinstance(note.get(f), str):
        errs.append(f"{f} 缺失/非 str")
if not isinstance(note.get("pinned"), bool):
    errs.append("pinned 缺失/非 bool")
if "tags" not in note:
    errs.append("tags 字段缺失（回归！iOS Note.tags 非 Optional）")
elif not isinstance(note["tags"], list):
    errs.append("tags 非数组")
print(("FAIL::"+"; ".join(errs)) if errs else ("OK::"+str(note.get("id",""))))
PY
)"

if printf '%s' "$NOTE_CHECK" | grep -q '^OK::'; then
  PASS=$((PASS + 1))
  printf '  ok   %-42s\n' "Note(POST 含 tags)"
  NEW_NID="${NOTE_CHECK#OK::}"
  # 清理：DELETE，避免留脏数据
  if [ -n "$NEW_NID" ]; then
    DEL_CODE="$(curl -s -o /dev/null -w '%{http_code}' -X DELETE "$BASE/api/notes/$NEW_NID" -H "$AUTH")"
    if [ "$DEL_CODE" = "200" ]; then
      printf '  ok   %-42s\n' "Note(DELETE 清理测试笔记)"
      PASS=$((PASS + 1))
    else
      # 直删失败：兜底再扫一遍，绝不留脏数据
      sweep_probe_notes
      printf '  WARN %-42s HTTP %s（已兜底清扫探针笔记）\n' "Note(DELETE 清理)" "$DEL_CODE"
    fi
  fi
else
  FAILED=$((FAILED + 1))
  reason="${NOTE_CHECK#FAIL::}"
  FAIL_MSGS+=("FAIL  Note(POST 含 tags)  $reason")
  printf '  FAIL %-42s %s\n' "Note(POST 含 tags)" "$reason"
fi

# ============================================================================
# 汇总
# ============================================================================
TOTAL=$((PASS + FAILED))
echo "======================================================================"
if [ "$FAILED" -eq 0 ]; then
  echo "契约冒烟 ${PASS}/${TOTAL} 通过"
  exit 0
else
  echo "契约冒烟 失败：${FAILED}/${TOTAL} 个断言未过"
  for m in "${FAIL_MSGS[@]}"; do echo "  - $m"; done
  exit 1
fi
