/**
 * 课件交互块（v4.3，吸收 H5P 交互设计，自研确定性渲染 + CSP 自包含 + 判分回传）。
 *
 * 与 H5P 的关系：只借「交互范式」，不引其 PHP/重运行时。两种题型都：
 *  - 服务端产纯 HTML（判分答案放 data-* 供 iframe 内 runtime 自检；服务端 mastery 才是记录源）；
 *  - 移动友好：不用 HTML5 drag（触屏不稳），拖词改「点词→填空、点空→退回」的点选交互；
 *  - 判分后经 ct-quiz 协议回传宿主 → 进 LessonQuizResult/错题本闭环（与 quiz 同管道）。
 *
 * 结构约定：segments（N 段文本）与 blanks（N-1 个空）交替：seg0 [空0] seg1 [空1] … segN。
 */

import type { Block } from "../blocks";
import { hashSeed } from "./courseware-design";

type FillBlock = Extract<Block, { type: "fillblank" }> & { id: string };
type DragBlock = Extract<Block, { type: "dragwords" }> & { id: string };

function esc(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");
}

/** 确定性洗牌（Fisher-Yates + seed，同输入同结果，可复现）。 */
function shuffle<T>(arr: T[], seed: number): T[] {
  const a = arr.slice();
  let s = seed >>> 0;
  for (let i = a.length - 1; i > 0; i--) {
    s = (s * 1664525 + 1013904223) >>> 0;
    const j = s % (i + 1);
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

/** 填空块：每空一个 input，data-ans 存可接受写法数组（runtime 归一比对）。 */
export function fillblankHtml(b: FillBlock): string {
  const parts: string[] = [];
  b.segments.forEach((seg, i) => {
    parts.push(esc(seg));
    if (i < b.blanks.length) {
      const ans = esc(JSON.stringify(b.blanks[i]));
      parts.push(
        `<input class="fb-in" type="text" autocomplete="off" autocapitalize="off" spellcheck="false" data-ans="${ans}" aria-label="填空 ${i + 1}">`,
      );
    }
  });
  return (
    `<div class="ia fb" data-bid="${esc(b.id)}" data-ia="fill">` +
    `<div class="ia-tag">填空练习</div>` +
    (b.prompt ? `<div class="ia-q">${esc(b.prompt)}</div>` : "") +
    `<div class="ia-body">${parts.join("")}</div>` +
    `<div class="ia-foot"><button class="ia-check" type="button">检查</button><span class="ia-fx"></span></div>` +
    `</div>`
  );
}

/** 拖词块：空位为可点 slot，词库为打乱的正解+干扰词；答案顺序放容器 data-ans。 */
export function dragwordsHtml(b: DragBlock, seed: number): string {
  const parts: string[] = [];
  b.segments.forEach((seg, i) => {
    parts.push(esc(seg));
    if (i < b.blanks.length) parts.push(`<span class="dw-slot" data-i="${i}" role="button" tabindex="0"></span>`);
  });
  const bank = shuffle([...b.blanks, ...(b.distractors ?? [])], seed);
  const words = bank
    .map((w, i) => `<button class="dw-word" type="button" data-w="${i}">${esc(w)}</button>`)
    .join("");
  const ans = esc(JSON.stringify(b.blanks));
  return (
    `<div class="ia dw" data-bid="${esc(b.id)}" data-ia="drag" data-ans="${ans}">` +
    `<div class="ia-tag">选词填空</div>` +
    (b.prompt ? `<div class="ia-q">${esc(b.prompt)}</div>` : "") +
    `<div class="ia-body">${parts.join("")}</div>` +
    `<div class="dw-bank">${words}</div>` +
    `<div class="ia-foot"><button class="ia-check" type="button">检查</button><span class="ia-fx"></span></div>` +
    `</div>`
  );
}

/** 交互块入口（renderBlock 调用）。dragwords 的洗牌用块 id 作种子，保证同课稳定可复现。 */
export function interactiveHtml(b: FillBlock | DragBlock): string {
  return b.type === "fillblank" ? fillblankHtml(b) : dragwordsHtml(b, hashSeed(`dw:${b.id}`));
}

/** 交互块 CSS（吃 art token，12 套 art 自动换肤）。 */
export const INTERACTIVE_CSS = `
/* —— 交互块（填空 / 拖词，v4.3）—— */
.ia{background:var(--ct-surface);border:1px solid var(--ct-border);border-radius:var(--ct-radius);box-shadow:var(--ct-shadow);padding:clamp(16px,3vw,24px)}
.ia-tag{display:inline-block;font-family:${"var(--ct-mono,monospace)"};font-size:11px;letter-spacing:.12em;text-transform:uppercase;color:var(--ct-accent-ink);background:var(--ct-accent-soft);border-radius:6px;padding:3px 9px;margin-bottom:12px}
.ia-q{font-size:15px;font-weight:600;color:var(--ct-ink);margin-bottom:12px;line-height:1.6}
.ia-body{font-size:16px;line-height:2.1;color:var(--ct-ink)}
.ia-foot{margin-top:16px;display:flex;align-items:center;gap:12px}
.ia-check{font:inherit;font-size:14px;font-weight:600;color:#fff;background:var(--ct-accent);border:0;border-radius:calc(var(--ct-radius) - 6px);padding:8px 20px;cursor:pointer;transition:opacity .2s var(--ct-ease)}
.ia-check:hover{opacity:.9}
.ia-check:disabled{opacity:.5;cursor:default}
.ia-fx{font-size:14px;font-weight:600}
.ia-fx.ok{color:#1f9e6e}.ia-fx.no{color:#c9403f}
/* 填空 input */
.fb-in{font:inherit;font-size:15px;color:var(--ct-ink);background:var(--ct-surface2);border:0;border-bottom:2px solid var(--ct-border);
  border-radius:4px 4px 0 0;padding:2px 8px;min-width:72px;width:auto;text-align:center;transition:border-color .2s var(--ct-ease)}
.fb-in:focus{outline:none;border-bottom-color:var(--ct-accent)}
.fb-in.ok{border-bottom-color:#1f9e6e;background:${"rgba(31,158,110,.1)"}}
.fb-in.no{border-bottom-color:#c9403f;background:${"rgba(201,64,63,.1)"}}
/* 拖词 slot + 词库 */
.dw-slot{display:inline-block;min-width:64px;min-height:1.5em;margin:0 2px;padding:1px 8px;border-bottom:2px dashed var(--ct-border);
  color:var(--ct-ink);cursor:pointer;text-align:center;vertical-align:baseline;transition:border-color .2s var(--ct-ease)}
.dw-slot.filled{border-bottom-style:solid;border-bottom-color:var(--ct-accent);background:var(--ct-accent-soft);border-radius:6px 6px 0 0}
.dw-slot.ok{border-bottom-color:#1f9e6e;background:${"rgba(31,158,110,.12)"}}
.dw-slot.no{border-bottom-color:#c9403f;background:${"rgba(201,64,63,.12)"}}
.dw-bank{display:flex;flex-wrap:wrap;gap:8px;margin-top:16px}
.dw-word{font:inherit;font-size:14px;color:var(--ct-ink);background:var(--ct-surface2);border:1px solid var(--ct-border);
  border-radius:calc(var(--ct-radius) - 6px);padding:6px 14px;cursor:pointer;transition:transform .12s var(--ct-ease),opacity .2s var(--ct-ease)}
.dw-word:hover{border-color:var(--ct-accent)}
.dw-word:active{transform:scale(.96)}
.dw-word.used{opacity:.32;pointer-events:none}
`;

/**
 * 交互块的 iframe 内运行时 JS（拼进 RUNTIME_SCRIPT）。
 * 判分：填空归一比对 data-ans；拖词比对 slot 词与 data-ans 顺序。判分后 postMessage ct-quiz 进错题闭环。
 */
export const INTERACTIVE_RUNTIME = `
  function norm(s){ return (s||'').trim().toLowerCase().replace(/\\s+/g,''); }
  function iaReport(root, correct){
    try{ parent.postMessage({type:'ct-quiz', bid: root.getAttribute('data-bid')||null, answer:0, correct:correct}, '*'); }catch(e){}
  }
  // 填空。可重试直到全对；掌握度只记**首次**作答（诚实反映真实记忆,重试是学习不是刷分）。
  document.querySelectorAll('.ia[data-ia="fill"]').forEach(function(root){
    var btn = root.querySelector('.ia-check'), fx = root.querySelector('.ia-fx');
    if(!btn) return;
    btn.addEventListener('click', function(){
      var ins = root.querySelectorAll('.fb-in'), all = true;
      ins.forEach(function(inp){
        var acc = []; try{ acc = JSON.parse(inp.getAttribute('data-ans')||'[]'); }catch(e){}
        var ok = acc.some(function(a){ return norm(a) === norm(inp.value); });
        inp.classList.remove('ok','no'); inp.classList.add(ok?'ok':'no');
        if(!ok) all = false;
      });
      if(fx){ fx.classList.remove('ok','no'); fx.classList.add(all?'ok':'no'); fx.textContent = all?'全对！':'标红处再想想，改完可再检查'; }
      if(!root.__iaReported){ root.__iaReported = true; iaReport(root, all); }
      if(all) btn.disabled = true;
    });
  });
  // 拖词（点词填空 / 点空退回）
  document.querySelectorAll('.ia[data-ia="drag"]').forEach(function(root){
    var slots = root.querySelectorAll('.dw-slot'), bank = root.querySelector('.dw-bank');
    var btn = root.querySelector('.ia-check'), fx = root.querySelector('.ia-fx');
    if(!btn || !bank) return;
    function nextEmpty(){ for(var i=0;i<slots.length;i++){ if(!slots[i].getAttribute('data-w')) return slots[i]; } return null; }
    function place(word, wi){ var s = nextEmpty(); if(!s) return; s.textContent = word.textContent; s.setAttribute('data-w', wi); s.classList.add('filled'); word.classList.add('used'); }
    function clearSlot(s){ var wi = s.getAttribute('data-w'); if(wi==null) return; var w = bank.querySelector('.dw-word[data-w="'+wi+'"]'); if(w) w.classList.remove('used'); s.textContent=''; s.removeAttribute('data-w'); s.classList.remove('filled','ok','no'); }
    bank.querySelectorAll('.dw-word').forEach(function(w){ w.addEventListener('click', function(){ if(w.classList.contains('used')) return; place(w, w.getAttribute('data-w')); }); });
    // stopPropagation：不加的话空格会冒泡到运行时的 window keydown（只豁免 INPUT/BUTTON 等）触发翻页,
    // 键盘用户退词的同时课件跳页（审计 P2）。
    slots.forEach(function(s){ s.addEventListener('click', function(){ clearSlot(s); }); s.addEventListener('keydown', function(e){ if(e.key==='Enter'||e.key===' '){ e.preventDefault(); e.stopPropagation(); clearSlot(s); } }); });
    btn.addEventListener('click', function(){
      var ans = []; try{ ans = JSON.parse(root.getAttribute('data-ans')||'[]'); }catch(e){}
      var all = true;
      slots.forEach(function(s, i){
        var wi = s.getAttribute('data-w');
        var txt = wi!=null ? (bank.querySelector('.dw-word[data-w="'+wi+'"]')||{}).textContent : '';
        var ok = norm(txt) === norm(ans[i]);
        s.classList.remove('ok','no'); s.classList.add(ok?'ok':'no');
        if(!ok) all = false;
      });
      if(fx){ fx.classList.remove('ok','no'); fx.classList.add(all?'ok':'no'); fx.textContent = all?'全对！':'标红处再调整，改完可再检查'; }
      if(!root.__iaReported){ root.__iaReported = true; iaReport(root, all); }
      if(all) btn.disabled = true;
    });
  });
`;
