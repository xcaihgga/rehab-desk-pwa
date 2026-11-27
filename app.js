

/* ============================================================
   康复病历工作台 — 应用逻辑
   ============================================================ */
const LS_KEY = 'rehab.desk.v1';
const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => Array.from(r.querySelectorAll(s));
const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const clone = (o) => JSON.parse(JSON.stringify(o));
const pad = (n) => String(n).padStart(2, '0');
const todayISO = () => { const d = new Date(); return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()); };
const nowHM = () => { const d = new Date(); return pad(d.getHours()) + ':' + pad(d.getMinutes()); };
// 日期解析为时间戳：兼容 / 分隔写法，非法日期返回 0，排序时排末尾，避免非 ISO 字符串比较错乱
const dateTs = (s) => { const t = Date.parse(String(s || '').replace(/\//g, '-')); return Number.isFinite(t) ? t : 0; };
// 日期归一：/、. 分隔统一为 -；非法或越界日期（如 13 月、30 日 2 月）返回 ''；合法返回 YYYY-MM-DD
const normDate = (v) => {
  const s = String(v == null ? '' : v).trim().replace(/[./]/g, '-');
  if (!s) return '';
  const m = /^(\d{4})-(\d{1,2})-(\d{1,2})$/.exec(s);
  if (!m) return '';
  const y = Number(m[1]), mo = Number(m[2]), d = Number(m[3]);
  const dt = new Date(y, mo - 1, d);
  if (dt.getFullYear() !== y || dt.getMonth() !== mo - 1 || dt.getDate() !== d) return '';
  return y + '-' + pad(mo) + '-' + pad(d);
};
const isValidDate = (s) => !!normDate(s);
/* ========== 输入稳定性：焦点恢复 + 中文输入法保护 + 防抖 ==========
   单文件前端用 innerHTML 整块重建 DOM，重建会销毁输入框：光标跳回起点、中文输入法被打断。
   三件事一起解决：① 输入法组合期间不触发重建；② 重建前记下焦点与选区、重建后放回去；
   ③ 搜索/筛选这类高频重建加短防抖。 */
let isComposing = false;
const _debounceTimers = {};
function debounceRun(key, fn, wait) {
  if (_debounceTimers[key]) clearTimeout(_debounceTimers[key]);
  _debounceTimers[key] = setTimeout(() => { delete _debounceTimers[key]; try { fn(); } catch (e) { console.warn('debounced task failed', e); } }, wait);
}
function cssEscapeSafe(s) {
  try { return (window.CSS && CSS.escape) ? CSS.escape(s) : String(s).replace(/[^a-zA-Z0-9_-]/g, '\\$&'); }
  catch (e) { return String(s).replace(/[^a-zA-Z0-9_-]/g, '\\$&'); }
}
function captureFocus() {
  const el = document.activeElement;
  if (!el || !el.parentNode) return null;
  const tag = (el.tagName || '').toLowerCase();
  // select 也要恢复：评估页的评分多数是下拉，重建后焦点丢了就没法连续点选
  if (tag !== 'input' && tag !== 'textarea' && tag !== 'select' && !el.isContentEditable && !el.hasAttribute('data-edit')) return null;
  let selector = '';
  if (el.id) selector = '#' + cssEscapeSafe(el.id);
  else if (el.name) selector = tag + '[name="' + cssEscapeSafe(el.name) + '"]';
  else {
    // 任何带 data-* 标识的录入控件都按该属性定位：评估下拉(data-assess)、病程组合下拉(data-compose)、
    // 评定日期(data-assess-date) 都在内。以前用固定白名单，新加控件一旦忘了登记，重建后焦点就掉回页面顶部。
    let attrs = [];
    try { attrs = Array.prototype.slice.call(el.attributes); } catch (e) { attrs = []; }
    for (let i = 0; i < attrs.length; i++) {
      const a = attrs[i];
      if (a.name.indexOf('data-') !== 0) continue;
      if (a.name === 'data-action' || a.name === 'data-tab' || a.name === 'data-subtab') continue;
      if (!String(a.value || '').length) continue;
      selector = tag + '[' + a.name + '="' + cssEscapeSafe(a.value) + '"]';
      break;
    }
  }
  if (!selector) return null;
  let sel = null;
  try {
    if (tag === 'input' || tag === 'textarea') {
      sel = { start: el.selectionStart, end: el.selectionEnd, dir: el.selectionDirection };
    } else if (el.isContentEditable || el.hasAttribute('data-edit')) {
      const ws = window.getSelection;
      if (ws && ws().rangeCount) {
        const r = ws().getRangeAt(0);
        const pre = r.cloneRange();
        pre.selectNodeContents(el);
        pre.setEnd(r.startContainer, r.startOffset);
        sel = { start: pre.toString().length, end: pre.toString().length + (r.endOffset - r.startOffset) };
      }
    }
  } catch (e) { sel = null; }
  return { selector: selector, sel: sel, tag: tag, editable: !!(el.isContentEditable || el.hasAttribute('data-edit')) };
}
function restoreFocus(snap) {
  if (!snap) return;
  let el = null;
  try { el = document.querySelector(snap.selector); } catch (e) { return; }
  if (!el) return;  // 重建后元素不存在（切页/切患者/列表空），不强行恢复
  try {
    if (snap.tag === 'input' || snap.tag === 'textarea' || snap.tag === 'select') {
      el.focus({ preventScroll: true });
      if ((snap.tag === 'input' || snap.tag === 'textarea') && snap.sel && el.setSelectionRange && el.type !== 'number' && el.type !== 'range') {
        const len = el.value ? el.value.length : 0;
        el.setSelectionRange(Math.min(snap.sel.start, len), Math.min(snap.sel.end, len), snap.sel.dir || 'forward');
      }
    } else if (snap.editable) {
      el.focus({ preventScroll: true });
      if (snap.sel && window.getSelection) {
        const ws = window.getSelection();
        const range = document.createRange();
        const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
        let offset = snap.sel.start, node = null, acc = 0;
        while (walker.nextNode()) {
          const len = walker.currentNode.textContent.length;
          if (acc + len >= offset) { node = walker.currentNode; break; }
          acc += len;
        }
        if (node) { range.setStart(node, Math.max(0, offset - acc)); range.collapse(true); }
        else { range.selectNodeContents(el); range.collapse(false); }
        ws.removeAllRanges();
        ws.addRange(range);
      }
    }
  } catch (e) { /* 恢复失败静默，不阻塞渲染 */ }
}

const uid = () => 'n' + Date.now().toString(36) + Math.random().toString(36).slice(2, 5);
const uniquePatientId = () => {
  let id;
  do { id = 'p' + Date.now().toString(36) + Math.random().toString(36).slice(2, 5); }
  while (state.patients.some((p) => p.id === id));
  return id;
};
const daysBetween = (a, b) => {
  const d1s = normDate(a);
  if (!d1s) return 0;
  const d2s = normDate(b) || todayISO();
  const d1 = new Date(d1s + 'T00:00:00'), d2 = new Date(d2s + 'T00:00:00');
  if (Number.isNaN(d1.getTime()) || Number.isNaN(d2.getTime())) return 0;
  return Math.max(0, Math.round((d2 - d1) / 86400000));
};
const monthDay = (s) => (s || '').slice(5).replace('-', '/');
const clamp = (v, min, max) => Math.min(max, Math.max(min, Number(v) || 0));
const safeFileName = (s) => String(s == null ? '' : s).replace(/[\\/:*?"<>|\r\n]+/g, '').trim() || '未命名';
// 类型守卫：导入/本地脏数据可能存在"字段存在但类型错误"，|| 兜底无法纠正，这里显式纠偏
const isObj = (v) => v != null && typeof v === 'object' && !Array.isArray(v);
const asArr = (v, fb = []) => (Array.isArray(v) ? v : fb);
const asObj = (v, fb = {}) => (isObj(v) ? v : fb);
const asStr = (v) => (v == null ? '' : String(v));
const asNum = (v, fb = 0) => { const n = Number(v); return Number.isFinite(n) ? n : fb; };

const DEFAULT_SETTINGS = { railScore: true, compact: false, assistantCollapsed: false, printSize: '10.5' };
let state = {
  settings: Object.assign({}, DEFAULT_SETTINGS),
  patients: [], currentId: '', tab: 'admit', assessTab: 'motor', atab: 'notes',
  assessFilter: 'all', assessQuery: '',
  filter: 'all', search: '', collapsed: false,
  draft: '', noteAdverse: '', compose: null, noteQuery: '', noteCat: '全部', doctor: '王医师',
  editingNoteId: '', pendingDeleteId: '',
  hospital: '', dept: '康复医学科', doctorTitle: '', supervisor: '',
  ddxDraft: '', voiceRec: null,
  viewMode: 'split', collapsedSec: {}, collapsedScale: {}, parseDraft: '',
  reportDraft: '', reportParsed: [], planMissed: [], drafts: {},
  customScales: [], seedRemoved: [], demoHintHidden: false,
  knOpen: null,  // 速查知识卡展开状态：null=按当前筛选决定默认
  scalePick: {}, // 量表按页签记"要看哪几个"；只渲染选中的卡，未选时只显示选择条
  pkMore: {}     // 量表选择条是否展开"更多"（未录入的自定义量表默认收起）
};

/* 经治医师落款：职称 + 姓名（职称可留空） */
function doctorLabel() {
  const name = state.doctor ? state.doctor : '—';
  return state.doctorTitle ? state.doctorTitle + ' ' + name : name;
}

/* 病程记录类型：首次病程 / 上级查房 / 日常病程；存量记录缺省按日常病程 */
const NOTE_TYPES = ['first', 'round', 'daily'];
const NOTE_TYPE_LABEL = { first: '首次病程', round: '上级查房', daily: '日常病程' };

/* S2 辅助检查分格：类别 → 关键词归类；顺序即打印/拼装顺序（other 兜底） */
const AUX_BOXES = [
  { key: 'ctmr', label: '头颅 CT / MRI', keys: ['ct', 'mri', '头颅', '脑', '核磁', '磁共振', 'cta', 'dsa'] },
  { key: 'emg', label: '肌电图 / 神经传导', keys: ['肌电图', '神经传导', 'emg', '诱发电位', 'mep', 'sep', '脑电图', 'eeg'] },
  { key: 'semg', label: '表面肌电', keys: ['表面肌电', 'semg', '肌电分析'] },
  { key: 'us', label: '关节 / 肌肉超声', keys: ['超声', 'b超', '彩超', '彩超'] },
  { key: 'cpet', label: '心肺运动试验', keys: ['心肺运动', 'cpet', '运动负荷', '运动试验', '六分钟', '6分钟'] },
  { key: 'lab', label: '常规化验 / 心电图', keys: ['血常规', '尿常规', '肝肾', '血糖', '血脂', '心电图', '化验', '电解质', '凝血', '胸片', 'x线', 'x线', '骨密度', '血沉', '蛋白', '抗体', '标志物'] },
  { key: 'other', label: '其他检查', keys: [] }
];
const AUX_BOX_KEYS = AUX_BOXES.map((x) => x.key);

/* S6 打印 / 导出排版令牌：与 styles.css :root 变量对齐；Word 内联样式只从这里取值 */
const PRINT_TOKENS = {
  fontFamily: '"宋体", SimSun',
  size: '10.5pt',
  lineHeight: 1.8,
  h1Size: '18pt',
  h2Size: '12pt',
  tableSize: '9pt',
  signLine: '0.5pt solid #000'
};

/* S6 导出章节单点映射表：章节 → 归属 sec → 取数字段 → 拼装规则；printHtml 标题与取数以此为准 */
const PRINT_SECTIONS = [
  { no: '一', title: '主诉', sec: 'chief', bind: 'record.chief' },
  { no: '二', title: '现病史', sec: 'chief', bind: 'record.present' },
  { no: '三', title: '既往史 / 个人史 / 家族史 / 过敏史', sec: 'chief', bind: 'record.past|record.personal|record.family|record.allergy', join: '　' },
  { no: '四', title: '体格检查', sec: 'exam', bind: 'record.vitals+record.examParts', join: '；' },
  { no: '五', title: '专科查体', sec: 'exam', bind: 'record.neuro' },
  { no: '辅助检查', title: '辅助检查', sec: 'exam', bind: 'record.auxBoxes', join: '；' },
  { no: '六', title: '中医四诊', sec: 'tcm', bind: 'record.tcm' },
  { no: '七', title: '康复评定', sec: 'assess', bind: 'latest(assessment)' },
  { no: '八', title: '初步诊断', sec: 'diag', bind: 'record.diagnoses' },
  { no: '九', title: '鉴别诊断', sec: 'ddx', bind: 'record.diffDx.items' },
  { no: '十', title: '康复问题与目标', sec: 'goal', bind: 'record.problems+record.goalsShort+record.goalsLong' },
  { no: '十一', title: '康复治疗方案', sec: 'goal', bind: 'record.plan' },
  { no: '十二', title: '病程记录', sec: 'course', bind: 'notes' },
  { no: '十三', title: '出院医嘱', sec: 'discharge', bind: 'discharge.advice' }
];

/* 打印章节标题单一来源：按 PRINT_SECTIONS 序号生成 h2，避免章节号/标题两处硬编码漂移。
   no 为中文序号时输出「序号、标题」，否则仅输出标题（如「辅助检查」）。 */
function printHead(i, suffix) {
  const s = PRINT_SECTIONS[i];
  const label = (/^[一二三四五六七八九十]+$/.test(s.no) ? s.no + '、' : '') + s.title;
  return '<h2 data-sec="' + s.sec + '">' + label + (suffix || '') + '</h2>';
}

/* S6 验收清单：逐项可核对；QC 面板 / 控制台按此打勾，verify 为可观察验收方式 */
const ACCEPTANCE_CHECKLIST = [
  { id: 'aux-box', area: '辅助检查分格', rule: '7 类分格独立存储；旧整段串迁入兜底格；派生串兼容旧读取点', verify: '录入页 7 格可填；打印按序连段；旧备份打开不丢内容' },
  { id: 'aux-map', area: '诊断—检查映射', rule: '鉴别建议检查按关键词命中对应格；只取映射格原文，空格不附结果', verify: '打印鉴别段附"现有结果（类别）"；映射格为空时不出现结果行' },
  { id: 'note-type', area: '病程三件套', rule: '首程/查房/日常三类；首程与日常署经治，查房署上级；时间线与打印带类型标签', verify: '落库 type/author 正确；切类型套骨架；旧记录归一日常' },
  { id: 'plan-phrase', area: '计划短语库', rule: '全称/别名归一；分段精确去重；未命中单列清单；不生成剂量频次', verify: '批量导入别名归一、去重；未命中标出清单' },
  { id: 'exam-parts', area: '查体分段', rule: '8 段独立存储，按序拼装；旧整段迁入一般情况段', verify: '8 格可填；派生 exam 按序连段；旧备份不丢' },
  { id: 'present-cand', area: '现病史候选', rule: '每病种主/备 ≥2 候选，点选填入可再改', verify: '候选 chips 出现且回填 present' },
  { id: 'layout', area: '排版常量', rule: '字体/字号/行距/页边距/签名下划线集中为令牌与 CSS 变量', verify: '改 :root 变量或 PRINT_TOKENS 即生效；Word 导出同源' },
  { id: 'offline', area: '离线单文件', rule: '无外链 script/link/fetch；file:// 打开演示数据正常无报错', verify: '打包后 grep 无 http 引用；独立打开控制台干净' }
];
const AUX_PH = {
  ctmr: '如：头颅 MRI 示右侧基底节区梗死灶；CT 早期无明显异常。',
  emg: '如：右侧胫前肌 EMG 呈神经源性损害；运动诱发电位潜伏期延长。',
  semg: '如：肱二头肌 / 股四头肌表面肌电募集欠佳。',
  us: '如：下肢静脉彩超未见血栓；关节超声示滑膜轻度增厚。',
  cpet: '如：6 分钟步行距离 280 m；运动负荷下血氧尚可。',
  lab: '如：血常规、肝肾功能、血糖血脂、电解质、心电图大致正常。',
  other: '其他功能检查结果，按需填写。'
};

/* S5 体格检查分段：顺序即拼装/打印顺序；旧版整段 exam 迁入 general 兜底段 */
const EXAM_SECTIONS = [
  { key: 'general', label: '一般情况' },
  { key: 'skin', label: '皮肤黏膜' },
  { key: 'headneck', label: '头颈' },
  { key: 'chest', label: '胸肺' },
  { key: 'heart', label: '心脏' },
  { key: 'abdomen', label: '腹部' },
  { key: 'limb', label: '四肢脊柱' },
  { key: 'neuro', label: '神经体征' }
];
const EXAM_SECTION_KEYS = EXAM_SECTIONS.map((x) => x.key);

// 我们的病种 key → bingli 模板 dept key 映射
const DEPT_MAP = { stroke:'neurology', spinal:'neurology', parkinson:'neurology', dementia:'neurology', frozenShoulder:'surgery', knee:'surgery', ankleSprain:'surgery', chronicPain:'general', diabeticFoot:'endocrinology', paraplegia:'neurology', multipleSclerosis:'neurology', neckback:'surgery', ortho:'surgery', geriatric:'general', cerebralPalsy: 'pediatrics', cp: 'pediatrics',
tbi: 'neurology',
tha: 'surgery',
tka: 'surgery',
rotatorCuff: 'surgery',
acl: 'surgery',
distalRadius: 'surgery',
handInjury: 'surgery',
  tbi: 'neurology',
  tha: 'surgery',
  tka: 'surgery',
  rotatorCuff: 'surgery',
  acl: 'surgery',
  distalRadius: 'surgery',
  handInjury: 'surgery',
  amputation: 'surgery',
  facialPalsy: 'neurology',
  vestibular: 'neurology',
  peripheralNerve: 'surgery' };

// bingli 科室 key → 中文科室名（诊断参考面板展示用）
const DEPT_LABEL = {
  cardiology: '心血管内科', digestive: '消化内科', emergency: '急诊', endocrinology: '内分泌科',
  general: '全科/综合', gynecology: '妇科', hematology: '血液科', nephrology: '肾内科',
  neurology: '神经内科', obstetrics: '产科', pediatrics: '儿科', psychiatry: '精神科',
  respiratory: '呼吸内科', surgery: '外科'
};

const P = () => state.patients.find((p) => p.id === state.currentId) || state.patients[0];
const latest = (p) => (Array.isArray(p.assessments) ? p.assessments[p.assessments.length - 1] : undefined);
const previous = (p) => (Array.isArray(p.assessments) && p.assessments.length > 1 ? p.assessments[p.assessments.length - 2] : null);
const isAffected = (side) => side === '右'; // 患侧索引：右=1，左=0

// 把当前内存草稿快照到指定患者的草稿桶；草稿按患者 id 键控持久化，刷新/崩溃不丢，切患者互不串档
function snapshotDraft(id) {
  id = id || state.currentId;
  if (!id || !isObj(state.drafts)) return;
  state.drafts[id] = {
    draft: state.draft, noteAdverse: state.noteAdverse, ddxDraft: state.ddxDraft, parseDraft: state.parseDraft,
    reportDraft: state.reportDraft, reportParsed: state.reportParsed, compose: state.compose, editingNoteId: state.editingNoteId
  };
}
// 纯回填：把指定患者草稿从桶读入内存，不做快照、不清桶；供切换与启动加载共用
function restoreDraft(id) {
  const d = (isObj(state.drafts) && state.drafts[id]) || {};
  state.draft = d.draft || '';
  state.noteAdverse = d.noteAdverse || '';
  state.ddxDraft = d.ddxDraft || '';
  state.reportDraft = d.reportDraft || '';
  state.reportParsed = Array.isArray(d.reportParsed) ? d.reportParsed : [];
  state.parseDraft = d.parseDraft || '';
  state.compose = d.compose ? clone(d.compose) : defaultCompose(P());
  if (!Array.isArray(state.compose.med)) state.compose.med = [];
  // 仅在原记录仍存在时恢复编辑态，避免记录被删除后误把草稿另存成新记录
  const pat = state.patients.find((x) => x.id === id);
  state.editingNoteId = (pat && Array.isArray(pat.notes) && pat.notes.some((n) => n.id === d.editingNoteId)) ? d.editingNoteId : '';
}
// 统一的患者切换入口：切换当前患者并按其病种重建病程生成配置与草稿，避免上一名患者的 compose 残留
function selectPatient(id) {
  snapshotDraft();   // 切换前先把当前患者草稿落回其草稿桶
  const exists = state.patients.some((p) => p.id === id);
  state.currentId = exists ? id : (state.patients[0] && state.patients[0].id);
  state.pendingDeleteId = '';   // 换患者时清掉未完成的删除确认
  restoreDraft(state.currentId);
  renderAll(false);
}

/* ---------------- 评分 ---------------- */
function barthelTotal(a) {
  return BARTHEL_ITEMS.reduce((s, it) => s + Number((a.barthel || {})[it.key] || 0), 0);
}
function barthelGrade(v) {
  if (v >= 100) return { label: '独立', level: 'ok' };
  if (v >= 61) return { label: '轻度依赖', level: 'ok' };
  if (v >= 41) return { label: '中度依赖', level: 'warn' };
  if (v >= 21) return { label: '重度依赖', level: 'bad' };
  return { label: '完全依赖', level: 'bad' };
}
function bergTotal(a) {
  return (a.berg || []).reduce((s, v) => s + Number(v || 0), 0);
}
function bergGrade(v) {
  if (v >= 41) return { label: '独立行走', level: 'ok' };
  if (v >= 21) return { label: '辅助行走', level: 'warn' };
  return { label: '轮椅/卧床', level: 'bad' };
}
function mmseTotal(a) {
  return MMSE_ITEMS.reduce((s, it) => s + Number((a.mmse || {})[it.key] || 0), 0);
}
function mmseGrade(v) {
  if (v >= 27) return { label: '认知正常', level: 'ok' };
  if (v >= 21) return { label: '轻度认知障碍', level: 'warn' };
  if (v >= 10) return { label: '中度认知障碍', level: 'bad' };
  return { label: '重度认知障碍', level: 'bad' };
}
function koudaInfo(v) {
  const l = KOUDA_LEVELS.find((x) => x.v === Number(v)) || KOUDA_LEVELS[0];
  return { label: l.grade + ' · ' + l.v + ' 级', level: l.v >= 3 ? 'bad' : (l.v === 2 ? 'warn' : 'ok') };
}
function masMax(a) {
  let m = 0;
  Object.values(a.mas || {}).forEach((arr) => { if (!Array.isArray(arr)) return;
    arr.forEach((v) => {
      const n = v === '1+' ? 1.5 : Number(v);
      if (n > m) m = n;
    });
  });
  return m;
}
function mmtOf(a, group, side) {
  const row = (a.mmt || {})[group] || [0, 0];
  return Number(row[side] || 0);
}
/* 枚举值白名单纠偏：畸形备份/旧档可能带任意字符串，直接进 HTML 或叙事会污染输出 */
function masLevel(v) {
  const s = asStr(v);
  return MAS_LEVELS.some((l) => l.v === s) ? s : '0';
}
function bsStage(v) {
  const s = asStr(v);
  return BRUNNSTROM_STAGES.some((x) => x.v === s) ? s : 'Ⅰ';
}
function affectedIndex(p) { return isAffected(p.side) ? 1 : 0; }
/* 侧别措辞前缀：左/右 → “左侧/右侧”；双侧 → “双侧”；空 → “患”。避免“双侧侧”这类叠字。 */
function sideLabel(side) {
  if (!side) return '患';
  if (side === '双侧') return '双侧';
  return side + '侧';
}

/* ================= 量表注册表（G5 可插拔） =================
 * 题型 kind：
 *  side-grid-select   左右对称下拉（MMT / MAS），值为 [左, 右]
 *  items-select       多条目下拉分值（Barthel）
 *  items-buttons04    多条目 0–4 档位按钮（Berg）
 *  items-number       多条目数值带上限（MMSE）
 *  stage-select       多部位分期下拉（Brunnstrom）
 *  single-select      单等级下拉（洼田 / Holden）
 *  slider             0–10 滑块（VAS）
 * 内置量表保留原有专用渲染、回写与叙事文案；注册表仅登记元数据并复用其总分/分级。
 * 自定义量表存于 state.customScales，评估值落在 a.custom[scaleId]。
 */
const BUILTIN_SCALES = [
  { id: 'mmt', title: '徒手肌力评定 MMT', tab: 'motor', kind: 'side-grid-select', max: 5, builtin: true,
    inSummary: true, inTrend: false, inNarrative: true, total: (a) => mmtOf(a, '膝伸展', affectedIndex(state.patients.find((x) => x.id === state.currentId))),
    grade: (v) => v >= 4 ? { label: '肌力良好', level: 'ok' } : v >= 3 ? { label: '抗重力', level: 'warn' } : { label: '肌力不足', level: 'bad' } },
  { id: 'mas', title: '改良 Ashworth 肌张力', tab: 'motor', kind: 'side-grid-select', max: 4, builtin: true,
    inSummary: true, inTrend: false, inNarrative: true, total: masMax,
    grade: (v) => v >= 2 ? { label: '痉挛明显', level: 'bad' } : v > 0 ? { label: '轻度增高', level: 'warn' } : { label: '无增高', level: 'ok' } },
  { id: 'brunnstrom', title: 'Brunnstrom 运动恢复分期', tab: 'motor', kind: 'stage-select', max: 6, builtin: true,
    inSummary: false, inTrend: false, inNarrative: true },
  { id: 'barthel', title: 'Barthel 指数（ADL）', tab: 'func', kind: 'items-select', max: 100, builtin: true,
    inSummary: true, inTrend: true, inNarrative: true, total: barthelTotal, grade: barthelGrade },
  { id: 'berg', title: 'Berg 平衡量表', tab: 'func', kind: 'items-buttons04', max: 56, builtin: true,
    inSummary: true, inTrend: true, inNarrative: true, total: bergTotal, grade: bergGrade },
  { id: 'holden', title: 'Holden 步行功能分级', tab: 'func', kind: 'single-select', max: 5, builtin: true,
    inSummary: false, inTrend: true, inNarrative: true, total: (a) => Number(a.holden) || 0,
    grade: (v) => v >= 4 ? { label: '接近独立', level: 'ok' } : v >= 2 ? { label: '需辅助', level: 'warn' } : { label: '不能步行', level: 'bad' } },
  { id: 'mmse', title: 'MMSE 简易精神状态检查', tab: 'special', kind: 'items-number', max: 30, builtin: true,
    inSummary: false, inTrend: true, inNarrative: true, total: mmseTotal, grade: mmseGrade },
  { id: 'kouda', title: '洼田饮水试验', tab: 'special', kind: 'single-select', max: 5, builtin: true,
    inSummary: true, inTrend: false, inNarrative: true, total: (a) => Number(a.kouda) || 0, grade: koudaInfo },
  { id: 'vas', title: 'VAS 疼痛评分', tab: 'special', kind: 'slider', max: 10, builtin: true,
    inSummary: true, inTrend: true, inNarrative: true, total: (a) => Number(a.vas) || 0,
    grade: (v) => v >= 7 ? { label: '重度疼痛', level: 'bad' } : v >= 4 ? { label: '中度疼痛', level: 'warn' } : { label: '轻度/无痛', level: 'ok' } }
];

/* 全部量表定义：内置 + 本地自定义；customScales 由 state 注入，避免加载期循环引用 */
function allScaleDefs() { return BUILTIN_SCALES.concat(asArr(state.customScales)); }
function scaleById(id) { return allScaleDefs().find((x) => x.id === id); }
/* 自定义量表在某次评估中的取值对象（兜底空对象，脏数据不崩） */
function customValues(a, def) { return isObj(a.custom) && isObj(a.custom[def.id]) ? a.custom[def.id] : {}; }

/* 通用总分：内置走注册 total；自定义按题型从 a.custom[def.id] 聚合 */
function scaleTotal(a, def) {
  if (!a) return 0;
  if (def.builtin && typeof def.total === 'function') return Number(def.total(a)) || 0;
  const v = customValues(a, def);
  if (def.kind === 'single-select' || def.kind === 'slider') return Number(v.value) || 0;
  if (def.kind === 'side-grid-select') {
    let s = 0, n = 0;
    (def.items || []).forEach((it) => { const row = asArr(v[it.key], [0, 0]); s += Number(row[0]) || 0; s += Number(row[1]) || 0; n += 2; });
    return n ? Math.round((s / n) * 10) / 10 : 0;
  }
  // items-select / items-buttons04 / items-number：条目分值求和
  return (def.items || []).reduce((sum, it) => sum + (Number(v[it.key]) || 0), 0);
}

/* 是否真的录入过值：打印稿与顶部汇总据此跳过未评定的量表，
   避免 22 个新增量表全部以「0 分」出现在报告里 */
function hasCustomValue(a, def) {
  if (!a || !isObj(a.custom) || !isObj(a.custom[def.id])) return false;
  const v = a.custom[def.id];
  if (def.kind === 'single-select' || def.kind === 'slider') return v.value != null && v.value !== '' && Number(v.value) > 0;
  if (def.kind === 'side-grid-select') return (def.items || []).some((it) => {
    const row = Array.isArray(v[it.key]) ? v[it.key] : [];
    return (Number(row[0]) || 0) > 0 || (Number(row[1]) || 0) > 0;
  });
  return (def.items || []).some((it) => Number(v[it.key]) > 0);
}

/* 通用分级：内置走注册 grade；自定义按 grades 区间命中。
   每条规则可带上界 max：无 max 时 v>=min 即命中；有 max 时 min<=v<=max。规则按下限从高到低，首个命中优先。 */
function scaleGrade(def, v) {
  v = Number(v) || 0;
  if (def.builtin && typeof def.grade === 'function') return def.grade(v);
  const rows = asArr(def.grades).slice().sort((x, y) => Number(y.min) - Number(x.min));
  const hit = rows.find((g) => {
    if (v < Number(g.min)) return false;
    if (g.max != null && g.max !== '' && Number(g.max) >= 0 && v > Number(g.max)) return false;
    return true;
  });
  return hit ? { label: asStr(hit.label), level: ['ok', 'warn', 'bad'].indexOf(hit.level) >= 0 ? hit.level : 'ok' } : { label: '', level: 'ok' };
}

/* 自定义量表定义归一：脏数据/导入兜底，保证 key 唯一、题型与开关合法 */
const SCALE_KINDS = ['side-grid-select', 'items-select', 'items-buttons04', 'items-number', 'stage-select', 'single-select', 'slider'];
const SCALE_TABS = ['motor', 'func', 'special'];
const SCALE_KIND_LABEL = {
  'side-grid-select': '左右对称下拉（肌力/肌张力）',
  'items-select': '多条目下拉分值',
  'items-buttons04': '多条目 0–4 档位按钮',
  'items-number': '多条目数值（带上限）',
  'stage-select': '多部位分期下拉',
  'single-select': '单等级下拉',
  'slider': '0–10 滑块'
};

function normalizeScaleDef(raw) {
  if (!isObj(raw)) return null;
  const def = {};
  def.id = /^u_/.test(asStr(raw.id)) ? asStr(raw.id) : 'u_' + uid();
  def.title = asStr(raw.title).trim();
  def.sub = asStr(raw.sub).trim();
  def.tab = SCALE_TABS.indexOf(raw.tab) >= 0 ? raw.tab : 'func';
  def.kind = SCALE_KINDS.indexOf(raw.kind) >= 0 ? raw.kind : 'items-select';
  def.max = asNum(raw.max, 0);
  def.note = asStr(raw.note);
  def.builtin = false;
  def.inSummary = raw.inSummary !== false;
  def.inTrend = raw.inTrend === true;
  def.inNarrative = raw.inNarrative !== false;
  def.levels = asArr(raw.levels).map((l, k) => ({ v: l && l.v != null ? l.v : k, label: asStr(l && l.label != null ? l.label : (l && l.v)) })).filter((l) => l && asStr(l.label).trim());
  const seen = new Set();
  def.items = asArr(raw.items).map((it, k) => {
    if (!isObj(it)) return null;
    const label = asStr(it.label).trim();
    if (!label) return null;
    let key = asStr(it.key).trim() || ('k' + k);
    if (seen.has(key)) key = 'k' + k;
    seen.add(key);
    const out = { key, label };
    const grp = asStr(it.group).trim();
    if (grp) out.group = grp;
    if (def.kind === 'items-number') out.max = asNum(it.max, def.max || 10);
    if (def.kind === 'items-select') out.levels = asArr(it.levels).map((lv) => [asNum(lv[0], 0), asStr(lv[1])]).filter((x) => asStr(x[1]).trim());
    return out;
  }).filter(Boolean);
  def.grades = asArr(raw.grades).map((g) => ({ min: asNum(g.min, 0), max: g.max == null ? null : asNum(g.max, -1), label: asStr(g.label), level: ['ok', 'warn', 'bad'].indexOf(g.level) >= 0 ? g.level : 'ok' })).filter((g) => asStr(g.label).trim());
  if (!['single-select', 'slider'].includes(def.kind) && !def.items.length) return null;
  return def;
}
function normalizeScaleDefs(list) { return asArr(list).map(normalizeScaleDef).filter(Boolean); }

/* ============================================================
   内置扩展量表（v1.21）
   走自定义量表通用渲染通道（state.customScales 种子）：
   id 以 u_seed_ 开头，用户删除后记入 state.seedRemoved，不再复活。
   评分口径见各量表的 note / SCALE_SOURCES，赋分与阈值需按原版核对后使用。
   ============================================================ */
const SEED_SCALES = [
  /* ---------- 运动功能 ---------- */
  {
    id: 'u_seed_fm_ue', title: 'Fugl-Meyer 上肢运动功能', sub: '33 项 · 满分 66', tab: 'motor',
    kind: 'items-number', max: 66, inSummary: false, inTrend: true, inNarrative: true,
    note: 'Fugl-Meyer 运动评定量表上肢部分（FMA-UE），每项 0–2 分，33 项满分 66；分数越低提示运动障碍越重。严重程度分级切点各研究不一、无统一界值，具体以量表原版及研究约定为准。',
    items: [
      { key: 'fm1', label: '肱二头肌反射', max: 2 },
      { key: 'fm2', label: '肱三头肌反射', max: 2 },
      { key: 'fm3', label: '肩外展伴屈肘（协同动作）', max: 2 },
      { key: 'fm4', label: '肩内收内旋伴屈肘（协同动作）', max: 2 },
      { key: 'fm5', label: '肘屈曲（协同动作）', max: 2 },
      { key: 'fm6', label: '肘伸展（协同动作）', max: 2 },
      { key: 'fm7', label: '肩屈曲 0–90°（协同）', max: 2 },
      { key: 'fm8', label: '肩外展 0–90°（协同）', max: 2 },
      { key: 'fm9', label: '肩外展 90–180°（协同）', max: 2 },
      { key: 'fm10', label: '肩屈曲 90–180°', max: 2 },
      { key: 'fm11', label: '肩外展 90–180°', max: 2 },
      { key: 'fm12', label: '肘伸展伴肩屈曲（分离运动）', max: 2 },
      { key: 'fm13', label: '肘屈曲伴肩外展（分离运动）', max: 2 },
      { key: 'fm14', label: '前臂旋前', max: 2 },
      { key: 'fm15', label: '前臂旋后', max: 2 },
      { key: 'fm16', label: '腕背伸 15°', max: 2 },
      { key: 'fm17', label: '腕背伸 >15°', max: 2 },
      { key: 'fm18', label: '腕背伸伴手指屈曲', max: 2 },
      { key: 'fm19', label: '腕稳定性（腕背伸位）', max: 2 },
      { key: 'fm20', label: '腕屈曲', max: 2 },
      { key: 'fm21', label: '腕环绕', max: 2 },
      { key: 'fm22', label: '集团屈曲（手指）', max: 2 },
      { key: 'fm23', label: '集团伸展（手指）', max: 2 },
      { key: 'fm24', label: '钩状抓握', max: 2 },
      { key: 'fm25', label: '拇指内收', max: 2 },
      { key: 'fm26', label: '拳握（拇指到食指）', max: 2 },
      { key: 'fm27', label: '手指伸展（拇指到食指）', max: 2 },
      { key: 'fm28', label: '圆柱抓握', max: 2 },
      { key: 'fm29', label: '球状抓握', max: 2 },
      { key: 'fm30', label: '指鼻试验（震颤）', max: 2 },
      { key: 'fm31', label: '指鼻试验（辨距不良）', max: 2 },
      { key: 'fm32', label: '快速轮替（震颤）', max: 2 },
      { key: 'fm33', label: '快速轮替（时间）', max: 2 }
    ]
  },
  {
    id: 'u_seed_fm_le', title: 'Fugl-Meyer 下肢运动功能', sub: '17 项 · 满分 34', tab: 'motor',
    kind: 'items-number', max: 34, inSummary: false, inTrend: true, inNarrative: true,
    note: 'FMA-LE 每项 0–2 分，17 项满分 34；分数越低提示下肢运动障碍越重，需结合步行能力与平衡综合判断。',
    items: [
      { key: 'fl1', label: '膝反射', max: 2 },
      { key: 'fl2', label: '跟腱反射', max: 2 },
      { key: 'fl3', label: '屈肌协同（髋屈-膝屈-踝背屈）', max: 2 },
      { key: 'fl4', label: '伸肌协同（髋伸-膝伸-踝跖屈）', max: 2 },
      { key: 'fl5', label: '坐位膝屈 >90°', max: 2 },
      { key: 'fl6', label: '俯卧膝屈 >90°', max: 2 },
      { key: 'fl7', label: '站立位踝背屈', max: 2 },
      { key: 'fl8', label: '坐位踝背屈', max: 2 },
      { key: 'fl9', label: '坐位踝跖屈', max: 2 },
      { key: 'fl10', label: '仰卧膝屈 >90°（髋伸）', max: 2 },
      { key: 'fl11', label: '坐位踝内翻', max: 2 },
      { key: 'fl12', label: '坐位踝外翻', max: 2 },
      { key: 'fl13', label: '站立位跟-趾行走', max: 2 },
      { key: 'fl14', label: '站立位足尖行走', max: 2 },
      { key: 'fl15', label: '站立位单腿屈膝', max: 2 },
      { key: 'fl16', label: '仰卧髋屈伴膝屈', max: 2 },
      { key: 'fl17', label: '仰卧膝伸伴髋伸', max: 2 }
    ]
  },
  {
    id: 'u_seed_borg', title: 'Borg 自觉疲劳程度（RPE）', sub: '6–20 级 · 运动强度监控', tab: 'motor',
    kind: 'single-select', max: 20, inSummary: false, inTrend: false, inNarrative: true,
    note: 'Borg 6–20 分级：12–13 相当于 60%–70% 最大心率，常用于心肺康复与有氧训练强度处方；训练中 RPE 15 以上建议降量并监测心率血压。',
    levels: [
      { v: 6, label: '6 · 极轻（静息）' }, { v: 7, label: '7 · 很轻' }, { v: 8, label: '8' },
      { v: 9, label: '9 · 很轻松' }, { v: 10, label: '10' }, { v: 11, label: '11 · 轻松' },
      { v: 12, label: '12' }, { v: 13, label: '13 · 稍吃力' }, { v: 14, label: '14' },
      { v: 15, label: '15 · 吃力' }, { v: 16, label: '16' }, { v: 17, label: '17 · 很吃力' },
      { v: 18, label: '18' }, { v: 19, label: '19 · 极吃力' }, { v: 20, label: '20 · 力竭' }
    ],
    grades: [
      { min: 17, max: 20, label: '高强度 · 需降量', level: 'bad' },
      { min: 15, max: 16, label: '中高强度', level: 'warn' },
      { min: 0, max: 14, label: '中低强度', level: 'ok' }
    ]
  },

  /* ---------- 步行与平衡 ---------- */
  {
    id: 'u_seed_tug', title: 'TUG 计时起立-行走测试', sub: '完成时间（秒）· 跌倒风险筛查', tab: 'func',
    kind: 'items-number', max: 60, inSummary: false, inTrend: true, inNarrative: true,
    note: '从带扶手座椅站起、直线走 3 m、转身返回坐下所用时间。<10 s 独立；10–19 s 多数可独立但需关注；≥20 s 提示需辅助；≥30 s 提示功能依赖、跌倒风险高。',
    items: [{ key: 'tug_t', label: '完成时间（秒）', max: 60 }],
    grades: [
      { min: 30, max: 60, label: '明显延迟 · 跌倒风险高', level: 'bad' },
      { min: 20, max: 29.9, label: '需辅助', level: 'bad' },
      { min: 10, max: 19.9, label: '轻度延迟', level: 'warn' },
      { min: 0, max: 9.9, label: '独立', level: 'ok' }
    ]
  },
  {
    id: 'u_seed_mw10', title: '10 米步行速度', sub: '用时（秒）· 步行能力核心指标', tab: 'func',
    kind: 'items-number', max: 60, inSummary: false, inTrend: false, inNarrative: true,
    note: '10 m 步行用时换算速度：≥1.0 m/s 可社区行走；0.6–1.0 m/s 社区行走受限；<0.6 m/s 以家庭内活动为主。卒中、骨科术后常用作步行能力的量化指标。',
    items: [{ key: 'mw10_t', label: '10 m 步行用时（秒）', max: 60 }],
    grades: [
      { min: 30, max: 60, label: '仅家庭内活动', level: 'bad' },
      { min: 15, max: 29.9, label: '步行速度明显减慢', level: 'warn' },
      { min: 10, max: 14.9, label: '社区行走受限', level: 'warn' },
      { min: 0, max: 9.9, label: '步行速度正常范围', level: 'ok' }
    ]
  },
  {
    id: 'u_seed_smwt', title: '6 分钟步行距离（6MWT）', sub: '距离（米）· 心肺耐力', tab: 'func',
    kind: 'items-number', max: 700, inSummary: false, inTrend: true, inNarrative: true,
    note: '按 ATS 规范在 30 m 走廊往返，记录 6 分钟步行距离，可同步记录前后心率、血氧与 Borg 评分。健康成人多在 400–700 m；数值受年龄、身高影响，个体前后对比更有意义。',
    items: [{ key: 'smwt_d', label: '6 分钟步行距离（米）', max: 700 }],
    grades: [
      { min: 400, max: 700, label: '耐力良好', level: 'ok' },
      { min: 300, max: 399, label: '轻度受限', level: 'warn' },
      { min: 0, max: 299, label: '明显受限', level: 'bad' }
    ]
  },

  /* ---------- 脊髓 / 骨科功能量表 ---------- */
  {
    id: 'u_seed_odi', title: 'ODI 腰椎功能障碍指数', sub: '10 项 · 满分 50（分数越高障碍越重）', tab: 'func',
    kind: 'items-select', max: 50, inSummary: false, inTrend: false, inNarrative: true,
    note: 'Oswestry 功能障碍指数，10 项各 0–5 分，实际得分/50×100% 为功能障碍百分比：0%–20% 轻度，21%–40% 中度，41%–60% 重度，61% 以上极重度。本版第 8 项为社交与休闲活动，原版为性生活项，如需原版请自行调整。',
    items: [
      { key: 'od1', label: '疼痛程度', levels: [[0, '0 · 无痛'], [1, '1 · 很轻'], [2, '2 · 中度'], [3, '3 · 较重'], [4, '4 · 严重'], [5, '5 · 极重']] },
      { key: 'od2', label: '个人生活自理（洗漱穿衣）', levels: [[0, '0 · 可独立完成'], [1, '1 · 可独立但很痛'], [2, '2 · 缓慢小心完成'], [3, '3 · 需要一些帮助'], [4, '4 · 每天大部分需帮助'], [5, '5 · 完全依赖']] },
      { key: 'od3', label: '提举物品', levels: [[0, '0 · 可提重物无痛'], [1, '1 · 可提重物但痛'], [2, '2 · 只能从地面提轻物'], [3, '3 · 只能提轻物（桌上高度）'], [4, '4 · 只能提很轻物品'], [5, '5 · 不能提任何物品']] },
      { key: 'od4', label: '行走', levels: [[0, '0 · 不限距离'], [1, '1 · 疼痛限制约 1 km'], [2, '2 · 约 500 m'], [3, '3 · 约 100 m'], [4, '4 · 需拐杖'], [5, '5 · 卧床为主，勉强如厕']] },
      { key: 'od5', label: '坐', levels: [[0, '0 · 任意时长'], [1, '1 · 需好座椅，不限时'], [2, '2 · 约 1 小时'], [3, '3 · 约 30 分钟'], [4, '4 · 约 10 分钟'], [5, '5 · 无法坐']] },
      { key: 'od6', label: '站立', levels: [[0, '0 · 不限时'], [1, '1 · 可站较久但痛'], [2, '2 · 约 1 小时'], [3, '3 · 约 30 分钟'], [4, '4 · 约 10 分钟'], [5, '5 · 无法站立']] },
      { key: 'od7', label: '睡眠', levels: [[0, '0 · 不受影响'], [1, '1 · 偶被痛醒'], [2, '2 · 约 1/4 夜被痛醒'], [3, '3 · 约 1/2 夜'], [4, '4 · 大部分时间'], [5, '5 · 完全无法入睡']] },
      { key: 'od8', label: '社交与休闲活动', levels: [[0, '0 · 不受限'], [1, '1 · 可参加但疼痛加重'], [2, '2 · 活动受限'], [3, '3 · 基本限于家中'], [4, '4 · 很少参与'], [5, '5 · 完全不参与']] },
      { key: 'od9', label: '家务劳动', levels: [[0, '0 · 可完成全部家务'], [1, '1 · 可完成但疼痛'], [2, '2 · 只能做轻家务'], [3, '3 · 只能做少量轻家务'], [4, '4 · 几乎不能做'], [5, '5 · 完全不能做']] },
      { key: 'od10', label: '外出与乘车', levels: [[0, '0 · 可自由外出'], [1, '1 · 可外出但疼痛'], [2, '2 · 短途可'], [3, '3 · 仅必要时外出'], [4, '4 · 极少外出'], [5, '5 · 基本卧床不出门']] }
    ],
    grades: [
      { min: 31, max: 50, label: '极重度功能障碍', level: 'bad' },
      { min: 21, max: 30, label: '重度功能障碍', level: 'bad' },
      { min: 11, max: 20, label: '中度功能障碍', level: 'warn' },
      { min: 0, max: 10, label: '轻度功能障碍', level: 'ok' }
    ]
  },
  {
    id: 'u_seed_womac', title: 'WOMAC 骨关节炎指数', sub: '24 项 · 满分 96', tab: 'func',
    kind: 'items-buttons04', max: 96, inSummary: false, inTrend: false, inNarrative: true,
    note: 'WOMAC 分疼痛（5 项）、僵硬（2 项）、功能（17 项）三个维度，每项 0–4 分（0 无，4 极重）。分数越高症状越重，可用于膝/髋骨关节炎康复前后对比。',
    items: [
      { key: 'w1', label: '疼痛 · 平地行走' },
      { key: 'w2', label: '疼痛 · 上下楼梯' },
      { key: 'w3', label: '疼痛 · 夜间在床上' },
      { key: 'w4', label: '疼痛 · 坐或卧时' },
      { key: 'w5', label: '疼痛 · 直立站立时' },
      { key: 'w6', label: '僵硬 · 晨起时' },
      { key: 'w7', label: '僵硬 · 白天休息后' },
      { key: 'w8', label: '功能 · 下楼梯' },
      { key: 'w9', label: '功能 · 上楼梯' },
      { key: 'w10', label: '功能 · 从坐位站起' },
      { key: 'w11', label: '功能 · 站立' },
      { key: 'w12', label: '功能 · 弯腰拾物' },
      { key: 'w13', label: '功能 · 平地行走' },
      { key: 'w14', label: '功能 · 上下车' },
      { key: 'w15', label: '功能 · 购物' },
      { key: 'w16', label: '功能 · 穿袜子' },
      { key: 'w17', label: '功能 · 起床' },
      { key: 'w18', label: '功能 · 脱袜子' },
      { key: 'w19', label: '功能 · 卧床翻身' },
      { key: 'w20', label: '功能 · 进出浴缸' },
      { key: 'w21', label: '功能 · 坐下' },
      { key: 'w22', label: '功能 · 从马桶起身' },
      { key: 'w23', label: '功能 · 重体力家务' },
      { key: 'w24', label: '功能 · 轻体力家务' }
    ],
    grades: [
      { min: 49, max: 96, label: '重度', level: 'bad' },
      { min: 25, max: 48, label: '中度', level: 'warn' },
      { min: 1, max: 24, label: '轻度', level: 'ok' },
      { min: 0, max: 0, label: '无明显症状', level: 'ok' }
    ]
  },
  {
    id: 'u_seed_lysholm', title: 'Lysholm 膝关节评分', sub: '8 项 · 满分 100', tab: 'func',
    kind: 'items-select', max: 100, inSummary: false, inTrend: false, inNarrative: true,
    note: 'Lysholm 评分用于膝韧带损伤、半月板术后功能评估：95 分以上优，84–94 良，65–83 可，65 以下差。',
    items: [
      { key: 'ly1', label: '跛行', levels: [[0, '0 · 持续跛行（严重）'], [3, '3 · 明显或经常跛行'], [5, '5 · 无或轻度跛行']] },
      { key: 'ly2', label: '支撑（负重）', levels: [[0, '0 · 需支具，无法负重'], [2, '2 · 需拐杖或支具'], [5, '5 · 不需支撑']] },
      { key: 'ly3', label: '交锁（卡住）', levels: [[0, '0 · 频繁交锁'], [5, '5 · 偶有交锁'], [10, '10 · 有卡阻感但无交锁'], [15, '15 · 无交锁']] },
      { key: 'ly4', label: '不稳定', levels: [[0, '0 · 每次活动均不稳'], [5, '5 · 日常活动常不稳'], [10, '10 · 剧烈活动时偶有'], [15, '15 · 运动时偶有'], [20, '20 · 罕见'], [25, '25 · 无']] },
      { key: 'ly5', label: '疼痛', levels: [[0, '0 · 持续剧痛'], [5, '5 · 剧烈疼痛'], [10, '10 · 明显疼痛'], [15, '15 · 轻度疼痛'], [20, '20 · 偶有疼痛'], [25, '25 · 无痛']] },
      { key: 'ly6', label: '肿胀', levels: [[0, '0 · 持续肿胀'], [2, '2 · 经常肿胀'], [6, '6 · 运动后肿胀'], [10, '10 · 无肿胀']] },
      { key: 'ly7', label: '上楼梯', levels: [[0, '0 · 不能上楼'], [2, '2 · 极度困难'], [6, '6 · 轻度困难'], [10, '10 · 无问题']] },
      { key: 'ly8', label: '下蹲', levels: [[0, '0 · 不能下蹲'], [1, '1 · 极度困难'], [3, '3 · 轻度困难'], [5, '5 · 无问题']] }
    ],
    grades: [
      { min: 84, max: 100, label: '良以上', level: 'ok' },
      { min: 65, max: 83, label: '可', level: 'warn' },
      { min: 0, max: 64, label: '差', level: 'bad' }
    ]
  },
  {
    id: 'u_seed_constant', title: 'Constant-Murley 肩关节评分', sub: '4 项 · 满分 100', tab: 'func',
    kind: 'items-number', max: 100, inSummary: false, inTrend: false, inNarrative: true,
    note: 'Constant 评分 = 疼痛 15 + 日常生活 20 + 关节活动度 40 + 肌力 25，满分 100。肩袖修复、冻结肩康复前后对比常用；90 分以上优，80–89 良，70–79 可，70 分以下差（可按年龄性别校正）。',
    items: [
      { key: 'co1', label: '疼痛（0–15 分）', max: 15 },
      { key: 'co2', label: '日常生活活动（0–20 分）', max: 20 },
      { key: 'co3', label: '关节活动度（0–40 分）', max: 40 },
      { key: 'co4', label: '肌力（0–25 分）', max: 25 }
    ],
    grades: [
      { min: 80, max: 100, label: '优/良', level: 'ok' },
      { min: 70, max: 79, label: '可', level: 'warn' },
      { min: 0, max: 69, label: '差', level: 'bad' }
    ]
  },
  {
    id: 'u_seed_fim', title: 'FIM 功能独立性评定', sub: '18 项 · 满分 126', tab: 'func',
    kind: 'items-select', max: 126, inSummary: false, inTrend: false, inNarrative: true,
    note: 'FIM 每项 1–7 分：1 完全依赖，2 最大帮助，3 中等帮助，4 最小帮助，5 监护或准备，6 改良独立，7 完全独立。126 分完全独立；108 分以上基本独立；72–107 轻中度依赖；<72 重度依赖。',
    items: [
      { key: 'fi1', label: '运动 · 进食', levels: [[1, '1 · 完全依赖'], [2, '2 · 最大帮助'], [3, '3 · 中等帮助'], [4, '4 · 最小帮助'], [5, '5 · 监护/准备'], [6, '6 · 改良独立'], [7, '7 · 完全独立']] },
      { key: 'fi2', label: '运动 · 梳洗', levels: [[1, '1 · 完全依赖'], [2, '2 · 最大帮助'], [3, '3 · 中等帮助'], [4, '4 · 最小帮助'], [5, '5 · 监护/准备'], [6, '6 · 改良独立'], [7, '7 · 完全独立']] },
      { key: 'fi3', label: '运动 · 洗澡', levels: [[1, '1 · 完全依赖'], [2, '2 · 最大帮助'], [3, '3 · 中等帮助'], [4, '4 · 最小帮助'], [5, '5 · 监护/准备'], [6, '6 · 改良独立'], [7, '7 · 完全独立']] },
      { key: 'fi4', label: '运动 · 上身穿衣', levels: [[1, '1 · 完全依赖'], [2, '2 · 最大帮助'], [3, '3 · 中等帮助'], [4, '4 · 最小帮助'], [5, '5 · 监护/准备'], [6, '6 · 改良独立'], [7, '7 · 完全独立']] },
      { key: 'fi5', label: '运动 · 下身穿衣', levels: [[1, '1 · 完全依赖'], [2, '2 · 最大帮助'], [3, '3 · 中等帮助'], [4, '4 · 最小帮助'], [5, '5 · 监护/准备'], [6, '6 · 改良独立'], [7, '7 · 完全独立']] },
      { key: 'fi6', label: '运动 · 如厕', levels: [[1, '1 · 完全依赖'], [2, '2 · 最大帮助'], [3, '3 · 中等帮助'], [4, '4 · 最小帮助'], [5, '5 · 监护/准备'], [6, '6 · 改良独立'], [7, '7 · 完全独立']] },
      { key: 'fi7', label: '括约肌 · 膀胱控制', levels: [[1, '1 · 完全依赖'], [2, '2 · 最大帮助'], [3, '3 · 中等帮助'], [4, '4 · 最小帮助'], [5, '5 · 监护/准备'], [6, '6 · 改良独立'], [7, '7 · 完全独立']] },
      { key: 'fi8', label: '括约肌 · 肠道控制', levels: [[1, '1 · 完全依赖'], [2, '2 · 最大帮助'], [3, '3 · 中等帮助'], [4, '4 · 最小帮助'], [5, '5 · 监护/准备'], [6, '6 · 改良独立'], [7, '7 · 完全独立']] },
      { key: 'fi9', label: '转移 · 床椅转移', levels: [[1, '1 · 完全依赖'], [2, '2 · 最大帮助'], [3, '3 · 中等帮助'], [4, '4 · 最小帮助'], [5, '5 · 监护/准备'], [6, '6 · 改良独立'], [7, '7 · 完全独立']] },
      { key: 'fi10', label: '转移 · 进出厕所', levels: [[1, '1 · 完全依赖'], [2, '2 · 最大帮助'], [3, '3 · 中等帮助'], [4, '4 · 最小帮助'], [5, '5 · 监护/准备'], [6, '6 · 改良独立'], [7, '7 · 完全独立']] },
      { key: 'fi11', label: '转移 · 进出浴缸/淋浴', levels: [[1, '1 · 完全依赖'], [2, '2 · 最大帮助'], [3, '3 · 中等帮助'], [4, '4 · 最小帮助'], [5, '5 · 监护/准备'], [6, '6 · 改良独立'], [7, '7 · 完全独立']] },
      { key: 'fi12', label: '运动 · 步行/轮椅', levels: [[1, '1 · 完全依赖'], [2, '2 · 最大帮助'], [3, '3 · 中等帮助'], [4, '4 · 最小帮助'], [5, '5 · 监护/准备'], [6, '6 · 改良独立'], [7, '7 · 完全独立']] },
      { key: 'fi13', label: '运动 · 上下楼梯', levels: [[1, '1 · 完全依赖'], [2, '2 · 最大帮助'], [3, '3 · 中等帮助'], [4, '4 · 最小帮助'], [5, '5 · 监护/准备'], [6, '6 · 改良独立'], [7, '7 · 完全独立']] },
      { key: 'fi14', label: '认知 · 理解', levels: [[1, '1 · 完全依赖'], [2, '2 · 最大帮助'], [3, '3 · 中等帮助'], [4, '4 · 最小帮助'], [5, '5 · 监护/准备'], [6, '6 · 改良独立'], [7, '7 · 完全独立']] },
      { key: 'fi15', label: '认知 · 表达', levels: [[1, '1 · 完全依赖'], [2, '2 · 最大帮助'], [3, '3 · 中等帮助'], [4, '4 · 最小帮助'], [5, '5 · 监护/准备'], [6, '6 · 改良独立'], [7, '7 · 完全独立']] },
      { key: 'fi16', label: '认知 · 社会交往', levels: [[1, '1 · 完全依赖'], [2, '2 · 最大帮助'], [3, '3 · 中等帮助'], [4, '4 · 最小帮助'], [5, '5 · 监护/准备'], [6, '6 · 改良独立'], [7, '7 · 完全独立']] },
      { key: 'fi17', label: '认知 · 问题解决', levels: [[1, '1 · 完全依赖'], [2, '2 · 最大帮助'], [3, '3 · 中等帮助'], [4, '4 · 最小帮助'], [5, '5 · 监护/准备'], [6, '6 · 改良独立'], [7, '7 · 完全独立']] },
      { key: 'fi18', label: '认知 · 记忆', levels: [[1, '1 · 完全依赖'], [2, '2 · 最大帮助'], [3, '3 · 中等帮助'], [4, '4 · 最小帮助'], [5, '5 · 监护/准备'], [6, '6 · 改良独立'], [7, '7 · 完全独立']] }
    ],
    grades: [
      { min: 108, max: 126, label: '基本独立', level: 'ok' },
      { min: 72, max: 107, label: '轻中度依赖', level: 'warn' },
      { min: 0, max: 71, label: '重度依赖', level: 'bad' }
    ]
  },

  /* ---------- 神经专科 ---------- */
  {
    id: 'u_seed_nihss', title: 'NIHSS 卒中量表', sub: '11 项 · 满分 42（分数越高缺损越重）', tab: 'special',
    kind: 'items-select', max: 42, inSummary: false, inTrend: false, inNarrative: true,
    note: 'NIHSS 0–1 分正常/接近正常，1–4 轻度，5–15 中度，16–20 中重度，21–42 重度。用于卒中急性期与康复期神经功能缺损评估，需按原版逐项评分。',
    items: [
      { key: 'ni1', label: '意识水平', levels: [[0, '0 · 清醒'], [1, '1 · 嗜睡'], [2, '2 · 昏睡'], [3, '3 · 昏迷']] },
      { key: 'ni2', label: '最佳凝视', levels: [[0, '0 · 正常'], [1, '1 · 部分凝视麻痹'], [2, '2 · 强迫凝视或完全麻痹']] },
      { key: 'ni3', label: '视野', levels: [[0, '0 · 无缺损'], [1, '1 · 部分偏盲'], [2, '2 · 完全偏盲'], [3, '3 · 双侧偏盲']] },
      { key: 'ni4', label: '面瘫', levels: [[0, '0 · 无'], [1, '1 · 轻度'], [2, '2 · 部分（中重度）'], [3, '3 · 完全']] },
      { key: 'ni5', label: '上肢运动（患侧）', levels: [[0, '0 · 无漂移'], [1, '1 · 可维持但漂移'], [2, '2 · 不能维持 10 s'], [3, '3 · 无抗重力'], [4, '4 · 无运动']] },
      { key: 'ni6', label: '下肢运动（患侧）', levels: [[0, '0 · 无漂移'], [1, '1 · 可维持但漂移'], [2, '2 · 不能维持 5 s'], [3, '3 · 无抗重力'], [4, '4 · 无运动']] },
      { key: 'ni7', label: '肢体共济失调', levels: [[0, '0 · 无'], [1, '1 · 一个肢体'], [2, '2 · 两个肢体']] },
      { key: 'ni8', label: '感觉', levels: [[0, '0 · 正常'], [1, '1 · 部分丧失'], [2, '2 · 完全丧失']] },
      { key: 'ni9', label: '语言', levels: [[0, '0 · 正常'], [1, '1 · 轻度失语'], [2, '2 · 严重失语'], [3, '3 · 缄默']] },
      { key: 'ni10', label: '构音障碍', levels: [[0, '0 · 正常'], [1, '1 · 轻度'], [2, '2 · 严重或缄默']] },
      { key: 'ni11', label: '忽视', levels: [[0, '0 · 无'], [1, '1 · 部分'], [2, '2 · 完全']] }
    ],
    grades: [
      { min: 21, max: 42, label: '重度缺损', level: 'bad' },
      { min: 16, max: 20, label: '中重度缺损', level: 'bad' },
      { min: 5, max: 15, label: '中度缺损', level: 'warn' },
      { min: 0, max: 4, label: '轻度/接近正常', level: 'ok' }
    ]
  },
  {
    id: 'u_seed_mrs', title: 'mRS 改良 Rankin 量表', sub: '0–6 级 · 全局残疾程度', tab: 'special',
    kind: 'single-select', max: 6, inSummary: false, inTrend: false, inNarrative: true,
    note: 'mRS 0 完全无症状，1 无明显残疾，2 轻度残疾（可自理但不能完成病前活动），3 中度残疾（需部分帮助），4 中重度（不能独立行走/自理），5 重度（卧床、需持续照护），6 死亡。',
    levels: [
      { v: 0, label: '0 · 完全无症状' },
      { v: 1, label: '1 · 无明显残疾，可完成日常生活' },
      { v: 2, label: '2 · 轻度残疾，不能完成病前所有活动但可自理' },
      { v: 3, label: '3 · 中度残疾，需部分帮助但可独立行走' },
      { v: 4, label: '4 · 中重度残疾，不能独立行走、需他人照顾' },
      { v: 5, label: '5 · 重度残疾，卧床、二便失禁、需持续照护' },
      { v: 6, label: '6 · 死亡' }
    ],
    grades: [
      { min: 5, max: 6, label: '重度残疾', level: 'bad' },
      { min: 3, max: 4, label: '中度残疾', level: 'warn' },
      { min: 0, max: 2, label: '轻度/无症状', level: 'ok' }
    ]
  },
  {
    id: 'u_seed_moca', title: 'MoCA 蒙特利尔认知评估', sub: '7 维度 · 满分 30', tab: 'special',
    kind: 'items-number', max: 30, inSummary: false, inTrend: false, inNarrative: true,
    note: 'MoCA 满分 30，<26 分提示认知功能损害（教育年限 ≤12 年者加 1 分校正）；对轻度认知障碍较 MMSE 敏感，需由培训过的评定者施测。',
    items: [
      { key: 'mo1', label: '视空间与执行（连线/立方体/钟表）', max: 5 },
      { key: 'mo2', label: '命名（3 种动物）', max: 3 },
      { key: 'mo3', label: '注意（数字广度/警觉/连续减 7）', max: 6 },
      { key: 'mo4', label: '语言（复述/流畅性）', max: 3 },
      { key: 'mo5', label: '抽象（词语相似性）', max: 2 },
      { key: 'mo6', label: '延迟回忆（5 个词）', max: 5 },
      { key: 'mo7', label: '定向（时间与地点）', max: 6 }
    ],
    grades: [
      { min: 26, max: 30, label: '认知正常范围', level: 'ok' },
      { min: 18, max: 25, label: '轻度认知损害可能', level: 'warn' },
      { min: 0, max: 17, label: '明显认知损害', level: 'bad' }
    ]
  },
  {
    id: 'u_seed_eat10', title: 'EAT-10 吞咽筛查', sub: '10 项 · 满分 40', tab: 'special',
    kind: 'items-buttons04', max: 40, inSummary: false, inTrend: false, inNarrative: true,
    note: 'EAT-10 每项 0–4 分（0 无问题，4 严重问题），总分 ≥3 提示可能存在吞咽效率与安全性问题，建议进一步行洼田饮水试验、VFSS 或 FEES 评估。',
    items: [
      { key: 'e1', label: '我的吞咽问题已导致体重下降' },
      { key: 'e2', label: '我的吞咽问题影响我外出进食' },
      { key: 'e3', label: '吞咽液体需要额外费力' },
      { key: 'e4', label: '吞咽固体食物需要额外费力' },
      { key: 'e5', label: '吞咽药片需要额外费力' },
      { key: 'e6', label: '吞咽时疼痛' },
      { key: 'e7', label: '吞咽问题使进食的愉悦感下降' },
      { key: 'e8', label: '进食时食物残留在咽喉部' },
      { key: 'e9', label: '进食时咳嗽' },
      { key: 'e10', label: '吞咽时感到紧张' }
    ],
    grades: [
      { min: 3, max: 40, label: '可疑吞咽障碍', level: 'warn' },
      { min: 0, max: 2, label: '筛查未见异常', level: 'ok' }
    ]
  },
  {
    id: 'u_seed_gcs', title: 'GCS 格拉斯哥昏迷评分', sub: '3 项 · 满分 15', tab: 'special',
    kind: 'items-number', max: 15, inSummary: false, inTrend: false, inNarrative: true,
    note: 'GCS = 睁眼（1–4）+ 语言（1–5）+ 运动（1–6），满分 15；13–15 轻度，9–12 中度，3–8 重度昏迷。气管插管或失语者语言项需标注无法评定。',
    items: [
      { key: 'gc1', label: '睁眼反应（E，1–4 分）', max: 4 },
      { key: 'gc2', label: '语言反应（V，1–5 分）', max: 5 },
      { key: 'gc3', label: '运动反应（M，1–6 分）', max: 6 }
    ],
    grades: [
      { min: 13, max: 15, label: '轻度', level: 'ok' },
      { min: 9, max: 12, label: '中度', level: 'warn' },
      { min: 0, max: 8, label: '重度昏迷', level: 'bad' }
    ]
  },

  /* ---------- 风险筛查与心理 ---------- */
  {
    id: 'u_seed_braden', title: 'Braden 压疮风险评分', sub: '6 项 · 满分 23（越低风险越高）', tab: 'special',
    kind: 'items-select', max: 23, inSummary: false, inTrend: false, inNarrative: true,
    note: 'Braden 6 项各 1–4 分：≤9 极度危险，10–12 高度危险，13–14 中度危险，15–18 轻度危险，≥19 无明显危险。卧床、脊髓损伤、营养不良患者入院与每周复评。',
    items: [
      { key: 'br1', label: '感知能力', levels: [[1, '1 · 完全受限'], [2, '2 · 非常受限'], [3, '3 · 轻度受限'], [4, '4 · 未受限']] },
      { key: 'br2', label: '潮湿程度', levels: [[1, '1 · 持续潮湿'], [2, '2 · 非常潮湿'], [3, '3 · 偶尔潮湿'], [4, '4 · 很少潮湿']] },
      { key: 'br3', label: '活动能力', levels: [[1, '1 · 卧床不起'], [2, '2 · 局限于椅'], [3, '3 · 偶尔行走'], [4, '4 · 经常行走']] },
      { key: 'br4', label: '移动能力', levels: [[1, '1 · 完全不能自主'], [2, '2 · 严重受限'], [3, '3 · 轻度受限'], [4, '4 · 不受限']] },
      { key: 'br5', label: '营养摄取', levels: [[1, '1 · 非常差'], [2, '2 · 可能不足'], [3, '3 · 充足'], [4, '4 · 非常好']] },
      { key: 'br6', label: '摩擦与剪切力', levels: [[1, '1 · 已存在问题'], [2, '2 · 潜在问题'], [3, '3 · 无明显问题']] }
    ],
    grades: [
      { min: 19, max: 23, label: '无明显危险', level: 'ok' },
      { min: 15, max: 18, label: '轻度危险', level: 'warn' },
      { min: 13, max: 14, label: '中度危险', level: 'warn' },
      { min: 10, max: 12, label: '高度危险', level: 'bad' },
      { min: 0, max: 9, label: '极度危险', level: 'bad' }
    ]
  },
  {
    id: 'u_seed_morse', title: 'Morse 跌倒风险评估', sub: '6 项 · 满分 125', tab: 'special',
    kind: 'items-select', max: 125, inSummary: false, inTrend: false, inNarrative: true,
    note: 'Morse ≥45 分高危，25–44 中危，<25 低危；高危患者需落实床栏、防滑鞋、呼叫器宣教与陪护，每周复评。',
    items: [
      { key: 'mr1', label: '近 3 个月跌倒史', levels: [[0, '0 · 无'], [25, '25 · 有']] },
      { key: 'mr2', label: '二次诊断（≥2 个疾病诊断）', levels: [[0, '0 · 无'], [15, '15 · 有']] },
      { key: 'mr3', label: '行走辅助器具', levels: [[0, '0 · 无/卧床/护士协助'], [15, '15 · 拐杖/助行器'], [30, '30 · 扶家具行走']] },
      { key: 'mr4', label: '静脉输液/肝素锁', levels: [[0, '0 · 无'], [20, '20 · 有']] },
      { key: 'mr5', label: '步态', levels: [[0, '0 · 正常/卧床/轮椅'], [10, '10 · 虚弱'], [20, '20 · 步态异常']] },
      { key: 'mr6', label: '精神状态', levels: [[0, '0 · 正确认识自身能力'], [15, '15 · 高估能力或忘记限制']] }
    ],
    grades: [
      { min: 45, max: 125, label: '跌倒高危', level: 'bad' },
      { min: 25, max: 44, label: '跌倒中危', level: 'warn' },
      { min: 0, max: 24, label: '跌倒低危', level: 'ok' }
    ]
  },
  {
    id: 'u_seed_caprini', title: 'Caprini 静脉血栓风险评分', sub: '常见 10 项 · 累加分值', tab: 'special',
    kind: 'items-select', max: 20, inSummary: false, inTrend: false, inNarrative: true,
    note: 'Caprini 按危险因素累加：0–1 低危，2 中危，3–4 高危，≥5 极高危。本表仅列康复科常见 10 项，完整评估请按原版 39 项执行；评分结果需结合出血风险决定预防措施。',
    items: [
      { key: 'cp1', label: '年龄 41–60 岁 / 61–74 岁 / ≥75 岁', levels: [[0, '0 · <41 岁'], [1, '1 · 41–60 岁'], [2, '2 · 61–74 岁'], [3, '3 · ≥75 岁']] },
      { key: 'cp2', label: 'BMI >25 kg/m²', levels: [[0, '0 · 否'], [1, '1 · 是']] },
      { key: 'cp3', label: '下肢水肿 / 静脉曲张', levels: [[0, '0 · 无'], [1, '1 · 有']] },
      { key: 'cp4', label: '卧床 >72 小时或石膏固定', levels: [[0, '0 · 无'], [2, '2 · 有']] },
      { key: 'cp5', label: '大手术（>45 分钟）', levels: [[0, '0 · 无'], [2, '2 · 有']] },
      { key: 'cp6', label: '恶性肿瘤 / 化疗', levels: [[0, '0 · 无'], [2, '2 · 有']] },
      { key: 'cp7', label: '既往深静脉血栓 / 肺栓塞史', levels: [[0, '0 · 无'], [3, '3 · 有']] },
      { key: 'cp8', label: '瘫痪 / 截瘫（近期）', levels: [[0, '0 · 无'], [2, '2 · 有']] },
      { key: 'cp9', label: '凝血功能异常（抗磷脂抗体等）', levels: [[0, '0 · 无'], [3, '3 · 有']] },
      { key: 'cp10', label: '中心静脉置管', levels: [[0, '0 · 无'], [2, '2 · 有']] }
    ],
    grades: [
      { min: 5, max: 20, label: '极高危', level: 'bad' },
      { min: 3, max: 4, label: '高危', level: 'bad' },
      { min: 2, max: 2, label: '中危', level: 'warn' },
      { min: 0, max: 1, label: '低危', level: 'ok' }
    ]
  },
  {
    id: 'u_seed_nrs2002', title: 'NRS2002 营养风险筛查', sub: '3 项 · 满分 7', tab: 'special',
    kind: 'items-select', max: 7, inSummary: false, inTrend: false, inNarrative: true,
    note: 'NRS2002 总分 ≥3 分提示存在营养风险，应请营养科会诊并制定营养支持方案；<3 分建议每周复评。年龄 ≥70 岁加 1 分。',
    items: [
      { key: 'nr1', label: '疾病严重程度（0–3 分）', levels: [[0, '0 · 无'], [1, '1 · 轻度（髋部骨折、慢性病急性发作）'], [2, '2 · 中度（腹部大手术、卒中、重症肺炎）'], [3, '3 · 重度（颅脑损伤、骨髓移植、ICU）']] },
      { key: 'nr2', label: '营养状态（0–3 分）', levels: [[0, '0 · 正常'], [1, '1 · 轻度（3 个月体重下降 >5%）'], [2, '2 · 中度（2 个月下降 >5% 或 BMI<20.5）'], [3, '3 · 重度（1 个月下降 >5% 或 BMI<18.5）']] },
      { key: 'nr3', label: '年龄 ≥70 岁', levels: [[0, '0 · 否'], [1, '1 · 是']] }
    ],
    grades: [
      { min: 3, max: 7, label: '存在营养风险', level: 'warn' },
      { min: 0, max: 2, label: '暂无营养风险', level: 'ok' }
    ]
  },
  {
    id: 'u_seed_phq9', title: 'PHQ-9 抑郁自评', sub: '9 项 · 满分 27', tab: 'special',
    kind: 'items-buttons04', max: 27, inSummary: false, inTrend: false, inNarrative: true,
    note: '过去 2 周症状频率：0 从不，1 几天，2 一半以上天数，3 几乎每天。5–9 轻度，10–14 中度，15–19 中重度，20–27 重度；第 9 题任何阳性均需评估自伤风险并转介。',
    items: [
      { key: 'p1', label: '做事时提不起劲或没有兴趣' },
      { key: 'p2', label: '感到心情低落、沮丧或绝望' },
      { key: 'p3', label: '入睡困难、睡不安稳或睡眠过多' },
      { key: 'p4', label: '感觉疲倦或没有活力' },
      { key: 'p5', label: '食欲不振或吃太多' },
      { key: 'p6', label: '觉得自己很糟，或觉得自己很失败' },
      { key: 'p7', label: '注意力难以集中（看报、看电视等）' },
      { key: 'p8', label: '动作或说话缓慢到他人可察觉，或烦躁坐立不安' },
      { key: 'p9', label: '有不如死掉或伤害自己的念头' }
    ],
    grades: [
      { min: 20, max: 27, label: '重度抑郁', level: 'bad' },
      { min: 15, max: 19, label: '中重度抑郁', level: 'bad' },
      { min: 10, max: 14, label: '中度抑郁', level: 'warn' },
      { min: 5, max: 9, label: '轻度抑郁', level: 'warn' },
      { min: 0, max: 4, label: '无明显抑郁', level: 'ok' }
    ]
  },
  {
    id: 'u_seed_gad7', title: 'GAD-7 广泛性焦虑自评', sub: '7 项 · 满分 21', tab: 'special',
    kind: 'items-buttons04', max: 21, inSummary: false, inTrend: false, inNarrative: true,
    note: '过去 2 周频率：0 从不，1 几天，2 一半以上天数，3 几乎每天。5–9 轻度，10–14 中度，15–21 重度；≥10 分建议转介心理专科评估。',
    items: [
      { key: 'g1', label: '感到紧张、焦虑或急切' },
      { key: 'g2', label: '无法停止或控制担忧' },
      { key: 'g3', label: '对各种各样的事情担忧过多' },
      { key: 'g4', label: '很难放松下来' },
      { key: 'g5', label: '坐立不安，难以静坐' },
      { key: 'g6', label: '容易烦恼或易怒' },
      { key: 'g7', label: '感到害怕，好像会有可怕的事发生' }
    ],
    grades: [
      { min: 15, max: 21, label: '重度焦虑', level: 'bad' },
      { min: 10, max: 14, label: '中度焦虑', level: 'warn' },
      { min: 5, max: 9, label: '轻度焦虑', level: 'warn' },
      { min: 0, max: 4, label: '无明显焦虑', level: 'ok' }
    ]
  }
];

/* 量表补种：首次加载 / 旧存档升级时注入；用户删除后记入 seedRemoved，不再复活。
   新增量表默认折叠，避免评估页一次展开几十张卡片。 */
function seedScales() {
  const removed = new Set(asArr(state.seedRemoved));
  // 不变量：seedRemoved 与 customScales 不得同时含同一 id。
  // 旧档或合并导入可能带来「已记录删除但副本仍在」的组合，此处统一剪除，避免已删除量表复活
  if (removed.size) state.customScales = asArr(state.customScales).filter((d) => !removed.has(d.id));
  const have = new Set(asArr(state.customScales).map((d) => d.id));
  SEED_SCALES.forEach((raw) => {
    if (removed.has(raw.id) || have.has(raw.id)) return;
    const def = normalizeScaleDef(raw);
    if (!def) return;
    state.customScales.push(def);
    if (!(def.title in state.collapsedScale)) state.collapsedScale[def.title] = true;
  });
}


/* ---------------- 文本生成 ---------------- */
function assessmentNarrative(p, a) {
  if (!a) return '暂未完成康复评定。';
  const aff = affectedIndex(p);
  const isStroke = (p.diagShort || '').indexOf('偏瘫') >= 0;
  const b = barthelTotal(a), bg = bergTotal(a), ms = mmseTotal(a);
  const knee = mmtOf(a, '膝伸展', aff), sh = mmtOf(a, '肩前屈', aff);
  const k = koudaInfo(a.kouda);
  const parts = [];
  /* 只写真正录过的量表：未评定的量表一律不出现在文本里，
     否则默认 0 分会变成"0 分 / 完全依赖"写进专科查体、出院小结与打印稿 */
  if (isTouched(a, 'barthel')) parts.push('Barthel 指数 ' + b + ' 分（' + barthelGrade(b).label + '）');
  if (isTouched(a, 'berg')) parts.push('Berg 平衡 ' + bg + ' 分（' + bergGrade(bg).label + '）');
  if (isTouched(a, 'mmt')) {
    if (isStroke) parts.push(sideLabel(p.side) + '上肢近端肌力 ' + sh + ' 级、下肢近端肌力 ' + knee + ' 级');
    else parts.push(sideLabel(p.side) + '下肢近端肌力 ' + knee + ' 级');
  }
  if (isTouched(a, 'mas') && masMax(a) > 0) parts.push('改良 Ashworth 最高 ' + (masMax(a) === 1.5 ? '1+' : masMax(a)) + ' 级');
  if (isTouched(a, 'brunnstrom') && isStroke) parts.push('Brunnstrom 上肢 ' + ((a.brunnstrom || {}).upper || '—') + ' 期、手 ' + ((a.brunnstrom || {}).hand || '—') + ' 期、下肢 ' + ((a.brunnstrom || {}).lower || '—') + ' 期');
  if (isTouched(a, 'kouda') && (isStroke || Number(a.kouda) >= 2)) parts.push('洼田饮水试验 ' + a.kouda + ' 级（' + k.label.split(' · ')[0] + '）');
  if (isTouched(a, 'mmse') && (isStroke || ms < 27)) parts.push('MMSE ' + ms + ' 分（' + mmseGrade(ms).label + '）');
  if (isTouched(a, 'holden')) parts.push('Holden 步行 ' + a.holden + ' 级');
  if (isTouched(a, 'vas') && Number(a.vas) > 0) parts.push('VAS 疼痛 ' + a.vas + ' 分');
  state.customScales.filter((d) => d.inNarrative).forEach((d) => {
    if (!hasCustomValue(a, d)) return;   // 0 分可能是真实结果，按"是否有值"判断而不是按分数判断
    const v = scaleTotal(a, d);
    const g = scaleGrade(d, v);
    parts.push(d.title + ' ' + v + (d.max ? ' /' + d.max : ' 分') + (g.label ? '（' + g.label + '）' : ''));
  });
  return parts.length ? parts.join('；') + '。' : '本次评定未录入量表评分。';
}

function deriveProblems(p, a) {
  if (!a) return [];
  const out = [];
  const isStroke = (p.diagShort || '').indexOf('偏瘫') >= 0;
  const b = barthelTotal(a), bg = bergTotal(a), ms = mmseTotal(a);
  const aff = affectedIndex(p);
  const knee = mmtOf(a, '膝伸展', aff);
  if (isTouched(a, 'brunnstrom') && isStroke) out.push(sideLabel(p.side) + '肢体运动功能障碍（Brunnstrom ' + ((a.brunnstrom || {}).upper || '—') + ' 期）');
  else if (isTouched(a, 'mmt') && knee < 5) out.push(sideLabel(p.side) + '下肢肌力下降（膝伸展 MMT ' + knee + ' 级）');
  if (isTouched(a, 'barthel') && b < 100) out.push('日常生活活动能力受限（Barthel ' + b + ' 分，' + barthelGrade(b).label + '）');
  if (isTouched(a, 'berg') && bg < 45) out.push('平衡功能下降，跌倒风险增加（Berg ' + bg + ' 分）');
  if (isTouched(a, 'mas') && masMax(a) >= 1.5) out.push('患肢肌张力增高（改良 Ashworth ' + (masMax(a) === 1.5 ? '1+' : masMax(a)) + ' 级）');
  if (isTouched(a, 'kouda') && Number(a.kouda) >= 3) out.push('吞咽功能障碍（洼田饮水试验 ' + a.kouda + ' 级）');
  if (isTouched(a, 'mmse') && ms < 24) out.push('认知功能下降（MMSE ' + ms + ' 分）');
  if (isTouched(a, 'vas') && Number(a.vas) >= 4) out.push('疼痛（VAS ' + a.vas + ' 分）');
  if (isTouched(a, 'holden') && Number(a.holden) <= 3) out.push('步行能力受限（Holden ' + a.holden + ' 级）');
  state.customScales.forEach((d) => {
    if (!hasCustomValue(a, d)) return;
    const v = scaleTotal(a, d), g = scaleGrade(d, v);
    if (g.level === 'bad') out.push(d.title + '受限（' + g.label + '，' + v + (d.max ? '/' + d.max : ' 分') + '）');
  });
  return out;
}

function deriveGoals(p, a) {
  if (!a) return { short: '', long: '' };
  const b = barthelTotal(a), bg = bergTotal(a), ms = mmseTotal(a);
  const aff = affectedIndex(p);
  const knee = mmtOf(a, '膝伸展', aff);
  const short = [], long = [];
  /* 目标只按"已评定的量表"起算：未评定的量表不生成"由 0 分提高至…"这类假目标 */
  if (isTouched(a, 'barthel') && b < 100) {
    const s1 = Math.min(100, b + 10), l1 = Math.min(100, b + 25);
    short.push('Barthel 指数由 ' + b + ' 分提高至 ' + s1 + ' 分');
    long.push('Barthel 指数提高至 ' + l1 + ' 分，ADL 达' + barthelGrade(l1).label);
  }
  if (isTouched(a, 'berg') && bg < 45) {
    const s2 = Math.min(56, bg + 8), l2 = Math.min(56, bg + 16);
    short.push('Berg 平衡由 ' + bg + ' 分提高至 ' + s2 + ' 分');
    long.push('Berg 平衡提高至 ' + l2 + ' 分（' + bergGrade(l2).label + '）');
  }
  if (isTouched(a, 'mmt') && knee < 5) {
    short.push(sideLabel(p.side) + '下肢近端肌力由 ' + knee + ' 级提升至 ' + Math.min(5, knee + 1) + ' 级');
  }
  if (isTouched(a, 'mas') && masMax(a) >= 1.5) short.push('改良 Ashworth 痉挛分级降至 1+ 级以内，被动活动改善');
  if (isTouched(a, 'kouda') && Number(a.kouda) >= 3) short.push('洼田饮水试验由 ' + a.kouda + ' 级改善至 ' + Math.max(1, Number(a.kouda) - 1) + ' 级，可安全进食糊状食物');
  if (isTouched(a, 'mmse') && ms < 27) short.push('MMSE 由 ' + ms + ' 分提升至 ' + Math.min(30, ms + 2) + ' 分，完成简单指令训练');
  if (isTouched(a, 'vas') && Number(a.vas) >= 4) short.push('VAS 疼痛评分由 ' + a.vas + ' 分降至 3 分以下');
  if (isTouched(a, 'holden') && Number(a.holden) < 4) short.push('Holden 步行分级提升 1 级，可在监护下完成室内步行');
  return {
    short: short.length ? '2 周内：' + short.join('；') + '。' : '',
    long: long.length ? '4 周内：' + long.join('；') + '；配合家庭训练巩固疗效。' : ''
  };
}

function derivePlan(p, a) {
  if (!a) return '';
  const aff = p.side || '患';
  const items = [];
  items.push('PT：' + (p.diagShort.indexOf('偏瘫') >= 0 ? '偏瘫肢体综合训练、坐站转移及平衡训练' : '关节松动、肌力及步态训练') + ' 30 min qd');
  items.push('OT：' + (Number(a.holden) <= 3 ? 'ADL 训练及上肢功能训练' : '作业活动与手功能训练') + ' 30 min qd');
  if (Number(a.kouda) >= 3) items.push('ST：吞咽功能训练 20 min qd');
  if (isTouched(a, 'mmse') && mmseTotal(a) < 24) items.push('认知训练 20 min qd');
  if (masMax(a) >= 1.5) items.push('抗痉挛体位摆放、被动牵伸及中频电疗');
  if (Number(a.vas) >= 4) items.push('理疗：中频/蜡疗镇痛');
  const needleSide = aff === '右' ? '左侧' : aff === '左' ? '右侧' : '双侧';
  items.push('中医：针刺（' + needleSide + '手足阳明经为主）、推拿各 1 次/日');
  return items.join('；') + '。';
}

/* 出院小结：由病历与历次评估自动拼装（供「生成小结」按钮与质控一键补全复用） */
function buildDischargeSummary(p) {
  const a = latest(p), first = p.assessments[0];
  const b = a ? barthelTotal(a) : 0, bg = a ? bergTotal(a) : 0, ms = a ? mmseTotal(a) : 0;
  const b0 = first ? barthelTotal(first) : b;
  const go = '予' + (p.record.plan || '康复评定及综合康复治疗') + (p.notes.length ? ' 等治疗，期间完成 ' + p.notes.length + ' 次病程记录。' : '');
  /* 小结里的分数只写已评定的量表：没录的料量表不出现"0 分"，也不写"入院 0 分" */
  const scoreSegs = [];
  if (isTouched(a, 'barthel')) scoreSegs.push('Barthel 指数 ' + b + ' 分（' + barthelGrade(b).label + (isTouched(first, 'barthel') ? '，入院 ' + b0 + ' 分' : '') + '）');
  if (isTouched(a, 'berg')) scoreSegs.push('Berg 平衡 ' + bg + ' 分');
  if (isTouched(a, 'mmse')) scoreSegs.push('MMSE ' + ms + ' 分');
  return '患者' + p.name + '，' + p.gender + '，' + p.age + ' 岁，因「' + (p.record.chief || p.diagShort) + '」于 ' + p.admitDate + ' 入院。' +
    (p.record.present ? '入院时' + p.record.present.slice(0, 90).replace(/。$/, '') + '。' : '') +
    '入院诊断：' + (p.record.diagnoses.join('、') || p.diagShort) + '。' + go +
    '出院时神志清，精神可，' + (p.side && p.side !== '双侧' ? p.side + '侧肢体' : '肢体') + '运动功能较入院改善' +
    (scoreSegs.length ? '，' + scoreSegs.join('，') : '') + '。' +
    '嘱继续康复训练、规律服药，按期复诊。';
}

/* ---------------- 存储 ---------------- */
const LS_WARN_BYTES = 3 * 1024 * 1024;  // 3MB：接近配额预警（同会话仅提示一次）
const LS_MAX_BYTES = 5 * 1024 * 1024;   // 5MB：浏览器常见配额上限参考值
const BACKUP_VERSION = 3;                // 备份结构版本号，旧版本经 migrate 兜底升级
/* 持久化字段单一事实源：本地存档与备份白名单同源于此，避免两处清单漂移丢字段。
   BACKUP_EXCLUDE 为有意不进备份的会话态字段（草稿仅本机暂存，导入时一律清空）。 */
const PERSIST_KEYS = ['patients', 'currentId', 'drafts', 'customScales', 'seedRemoved', 'doctor', 'hospital', 'dept', 'doctorTitle', 'supervisor', 'settings'];
const BACKUP_EXCLUDE = ['drafts'];
let saveTimer = null;
let lastSaveFailed = false;
let persistWarned = false;
let lastSeenRaw = null;                  // 最近一次读到/写入的存档原文，用于多窗口覆盖写检测
let conflictWarned = false;
/* 存档损坏保护：原文先另存到独立键，禁止自动保存覆盖，直到医生自己确认；
   多窗口冲突：是否处于「本页停止落盘」状态，可由医生手动接管 */
let savePaused = false;
let corruptRaw = '';
let corruptKey = '';
let conflictBlocked = false;
let saveDirty = false;                   // 暂停/停写期间是否有未落盘的改动

function persistPayloadObj() {
  snapshotDraft();
  const out = { version: BACKUP_VERSION };
  PERSIST_KEYS.forEach((k) => { out[k] = state[k]; });
  return out;
}
/* 备份载荷与本地存档同源：白名单外的字段不落备份，排除项集中声明 */
function backupPayloadObj(extra) {
  const src = persistPayloadObj();
  const out = Object.assign({ app: '康复病历工作台', exportedAt: todayISO() + ' ' + nowHM() }, extra || {});
  out.version = src.version;
  PERSIST_KEYS.filter((k) => BACKUP_EXCLUDE.indexOf(k) < 0).forEach((k) => { out[k] = src[k]; });
  return out;
}
function byteSizeOf(str) {
  try { return new Blob([str]).size; } catch (e) { return str.length * 2; }
}
/* 满额/异常时的紧急备份：在内存数据丢失前先落一份 Blob 下载 */
function emergencyBackup(reason) {
  try {
    const data = backupPayloadObj({ emergencyReason: reason });
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = '紧急备份_' + todayISO() + '_' + nowHM().replace(':', '') + '.json';
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 3000);
  } catch (e) { console.warn('emergency backup failed', e); }
}
function persistPayload() {
  let serialized;
  try {
    serialized = JSON.stringify(persistPayloadObj());
  } catch (e) {
    throw { kind: 'serialize', error: e };
  }
  const bytes = byteSizeOf(serialized);
  if (bytes > LS_WARN_BYTES && !persistWarned) {
    persistWarned = true;
    const mb = (bytes / 1024 / 1024).toFixed(1);
    toast(bytes > LS_MAX_BYTES
      ? ('本地数据已超 5MB 上限（约 ' + mb + 'MB），极可能无法继续保存，请立即导出备份')
      : ('本地数据已接近浏览器存储上限（约 ' + mb + 'MB），建议尽快导出备份'));
  }
  try {
    // 多窗口覆盖写防护：整载荷写入前先比对存档原文，若已被其他窗口改动则不覆盖，
    // 先落一份紧急备份保住本窗口内存数据，再交由上层提示用户导出/重载（本机制不做合并）
    let cur = null;
    try { cur = localStorage.getItem(LS_KEY); } catch (e) { cur = lastSeenRaw; }
    if (lastSeenRaw !== null && cur !== lastSeenRaw) {
      emergencyBackup('另一个标签页改动了数据，这边未覆盖');
      throw { kind: 'conflict' };
    }
    localStorage.setItem(LS_KEY, serialized);
    lastSeenRaw = serialized;
  } catch (e) {
    if (e && e.kind === 'conflict') throw e;
    const name = (e && e.name) || '';
    if (/QuotaExceededError|QuotaExceeded/i.test(name)) {
      emergencyBackup('本地存储空间已满');
      throw { kind: 'quota', error: e };
    }
    if (/SecurityError/i.test(name)) {
      throw { kind: 'security', error: e };
    }
    throw { kind: 'storage', error: e };
  }
}
function scheduleSave() {
  const el = $('#saveState');
  if (savePaused) {
    saveDirty = true;
    if (el) { el.classList.remove('saving'); el.classList.add('fail'); el.lastElementChild.textContent = '存档损坏 · 已暂停保存（点此处理）'; el.title = '原始存档已另存留证，点击查看处理方式'; }
    return;
  }
  if (conflictBlocked) {
    saveDirty = true;
    if (el) { el.classList.remove('saving'); el.classList.add('fail'); el.lastElementChild.textContent = '已停止保存 · 点此接管'; el.title = '另一个标签页改过存档，本页暂停落盘；确认那边已关闭后可接管'; }
    return;
  }
  if (el) { el.classList.add('saving'); el.classList.remove('fail'); el.lastElementChild.textContent = '保存中…'; }
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    try {
      persistPayload();
      lastSaveFailed = false;
      saveDirty = false;
      if (el) { el.classList.remove('saving', 'fail'); el.lastElementChild.textContent = '已保存 ' + nowHM(); }
    } catch (e) {
      // 分类提示：配额满（已自动紧急备份）/ 隐私模式禁用存储 / 序列化失败 / 其余；均保留内存数据，不静默
      lastSaveFailed = true;
      if (el) { el.classList.remove('saving'); el.classList.add('fail'); el.lastElementChild.textContent = '保存失败，请导出备份'; }
      const kind = (e && e.kind) || 'storage';
      if (kind === 'conflict') {
        conflictBlocked = true;
        if (el) { el.lastElementChild.textContent = '已停止保存 · 点此接管'; el.title = '另一个标签页改过存档，本页暂停落盘；确认那边已关闭后可接管'; }
        toast('这个工具在另一个标签页里被改过，为了不冲掉那边的记录，本次没有保存。已自动导出紧急备份；如果那边已经关掉，点右上角「已停止保存」可接管继续写入。');
      }
      else if (kind === 'quota') toast('本地存储已满，已自动导出一份紧急备份，请保存后清理或导出旧数据');
      else if (kind === 'security') toast('浏览器处于隐私模式或禁用了本地存储，本次数据不会持久化，请定期导出备份');
      else if (kind === 'serialize') toast('数据序列化失败，未写入本地，请尽快导出备份文件');
      else toast('本地保存失败（存储空间不足或被浏览器限制），请尽快导出备份文件');
    }
  }, 450);
}
function persistNow() {
  if (savePaused || conflictBlocked) { saveDirty = true; return; }
  const el = $('#saveState');
  try {
    persistPayload();
    lastSaveFailed = false;
    if (el) { el.classList.remove('saving', 'fail'); el.lastElementChild.textContent = '已保存 ' + nowHM(); }
  } catch (e) {
    // 兜底落盘失败同样刷新状态条为红色失败态，避免界面仍显示「已保存」误导；卸载阶段不强弹 toast
    lastSaveFailed = true;
    if (el) { el.classList.remove('saving'); el.classList.add('fail'); el.lastElementChild.textContent = '保存失败，请导出备份'; }
    console.warn('persistNow failed', e);
  }
}
/* ---- 存档异常处理面板：损坏 / 多窗口冲突，两种都涉及「数据要不要保」，必须由医生点确认 ---- */
function openSaveHelp() {
  if (savePaused) {
    $('#modal').innerHTML = '<div class="modal-head"><h3>本地存档打不开</h3><button class="icon-btn x" data-action="close-modal">×</button></div>'
      + '<div class="modal-body">'
      + '<p class="confirm-sub">这份存档的内容已经读不出来了（文件被截断、被手工改过，或磁盘写满时中断）。为了不把它覆盖掉，工具已经<b>暂停保存</b>，现在看到的是演示病人，不是你的真实病历。</p>'
      + '<p class="confirm-sub">损坏的原文已经另存了一份在浏览器里' + (corruptKey ? '（已留证）' : '（留证失败，请立刻导出）') + '。建议顺序：</p>'
      + '<div class="export-list">'
      + '<button class="btn outline" data-action="corrupt-export"><b>1. 先导出损坏原文</b><span>存成 .txt 文件，交技术人员抢救；这一步不改动任何东西。</span></button>'
      + '<button class="btn outline" data-action="corrupt-accept"><b>2. 放弃旧档，用现在的内容新建</b><span>会覆盖坏掉的那份；损坏原文仍留在浏览器里，可随时导出。</span></button>'
      + '</div><p class="export-note">如果这份档很重要，先做第 1 步，别急着点第 2 步。</p></div>'
      + '<div class="modal-foot"><button class="btn outline" data-action="close-modal">先不动</button></div>';
    openModal();
    return;
  }
  if (conflictBlocked) {
    $('#modal').innerHTML = '<div class="modal-head"><h3>另一个窗口改过同一份存档</h3><button class="icon-btn x" data-action="close-modal">×</button></div>'
      + '<div class="modal-body">'
      + '<p class="confirm-sub">这个工具在两个标签页（或两个窗口）里同时开着，那边已经写过一次。为避免互相覆盖，本页已<b>停止保存</b>——现在录入的内容只在这台电脑的内存里，关掉页面就没了。</p>'
      + '<p class="confirm-sub">先确认那边已经关闭、不会再写；然后点下面接管，本页从这一刻起正常保存。</p>'
      + '<p class="confirm-sub">如果那边还在用，请先在那边处理完并关掉；这边可以先「导出备份」保命。</p>'
      + '</div><div class="modal-foot">'
      + '<button class="btn outline" data-action="export-backup">先导出备份</button>'
      + '<button class="btn solid" data-action="takeover-save">那边已关闭，接管保存</button>'
      + '</div>';
    openModal();
    return;
  }
  toast('保存正常，不需要处理');
}
function exportCorruptRaw() {
  if (!corruptRaw) { toast('没有可取回的原始存档'); return; }
  downloadText('损坏存档原文_' + todayISO() + '_' + nowHM().replace(':', '') + '.txt', corruptRaw, 'text/plain;charset=utf-8');
  toast('已导出损坏原文，可交技术人员抢救');
}
function acceptCorrupt() {
  $('#modal').innerHTML = '<div class="modal-head"><h3>确认用现在的内容新建存档？</h3><button class="icon-btn x" data-action="close-modal">×</button></div>'
    + '<div class="modal-body"><p class="confirm-sub">点确认后，本机会用<b>当前屏幕上显示的内容</b>覆盖那份打不开的存档。损坏原文仍留在浏览器里，可以从上一屏的「导出损坏原文」取回。</p>'
    + '<p class="confirm-sub">如果你还没导出损坏原文，建议先返回上一步导出。</p></div>'
    + '<div class="modal-foot"><button class="btn outline" data-action="close-modal">再想想</button><button class="btn solid" data-action="corrupt-confirm">确认新建</button></div>';
  openModal();
}
function acceptCorruptNow() {
  savePaused = false;
  corruptRaw = '';
  saveDirty = false;
  lastSeenRaw = null;   // 显式放行这一次覆盖：损坏原文已另行留证
  try {
    persistPayload();
    lastSaveFailed = false;
    conflictBlocked = false;
    const el = $('#saveState');
    if (el) { el.classList.remove('saving', 'fail'); el.title = ''; el.lastElementChild.textContent = '已保存 ' + nowHM(); }
    closeModal();
    toast('已用当前内容新建存档；损坏原文仍留在浏览器里');
  } catch (e) {
    savePaused = true;
    closeModal();
    toast('新建失败（存储空间不足或浏览器限制），请先导出备份');
  }
  renderAll();
}
function takeOverSave() {
  let cur = null;
  try { cur = localStorage.getItem(LS_KEY); } catch (e) { cur = null; }
  lastSeenRaw = cur;        // 以磁盘上的最新原文为新基线，此后本页写入不再被判冲突
  conflictBlocked = false;
  conflictWarned = true;
  saveDirty = false;
  persistNow();
  closeModal();
  const el = $('#saveState');
  if (el && !lastSaveFailed) { el.classList.remove('saving', 'fail'); el.title = ''; el.lastElementChild.textContent = '已保存 ' + nowHM(); }
  toast(lastSaveFailed ? '接管失败，请先导出备份' : '已接管保存，本页后续录入会正常落盘');
}

/* 备份/本地存档版本迁移位：旧结构在此逐版本兜底升级后再交 normalizePatient 纠偏 */
function migrate(saved) {
  if (!isObj(saved)) return saved;
  // 本地存档 v1/v2 未写 version 字段，缺失按 v1 处理；v3 起随载荷落版本号
  const v = Number.isFinite(Number(saved.version)) ? Number(saved.version) : 1;
  if (v < 3) {
    // v1/v2 → v3：结构未变，仅补齐版本与缺省集合；seedRemoved 缺失补空数组，
    // 避免旧档导入后已删除的内置量表因缺字段而复活
    if (!Array.isArray(saved.seedRemoved)) saved.seedRemoved = [];
  }
  saved.version = BACKUP_VERSION;
  return saved;
}
function loadState() {
  let saved = null;
  let raw = null;
  try { raw = localStorage.getItem(LS_KEY); saved = JSON.parse(raw || 'null'); } catch (e) { saved = null; corruptRaw = String(raw || ''); }
  lastSeenRaw = raw;   // 覆盖写检测基线：null 表示本地尚无存档，首次写入放行
  /* 关键区分：原文存在却解析不出对象 = 存档损坏，不能当「首次使用」回填演示病人后覆盖掉。
     先把原文另存一份留证，再暂停自动保存，等医生在界面里确认。 */
  if (!corruptRaw && raw && raw.trim() && raw.trim() !== 'null' && !isObj(saved)) corruptRaw = raw;
  if (corruptRaw && corruptRaw.trim()) {
    savePaused = true;
    corruptKey = LS_KEY + '.corrupt.' + Date.now();
    try { localStorage.setItem(corruptKey, corruptRaw); } catch (e) { corruptKey = ''; }
  }
  saved = migrate(saved);
  // 有存档且 patients 是数组（哪怕被用户清空为空数组）就以存档为准，不再回填演示数据；
  // 只有「从未保存过」或结构损坏时才给首次使用者的演示病人。
  const hasSavedPatients = !!(saved && Array.isArray(saved.patients));
  state.patients = hasSavedPatients ? saved.patients : clone(INITIAL_PATIENTS);
  state.currentId = (saved && Array.isArray(saved.patients) && saved.patients.some((p) => p.id === saved.currentId)) ? saved.currentId : (state.patients[0] ? state.patients[0].id : null);
  if (saved && saved.doctor) state.doctor = saved.doctor;
  if (saved) {
    if (saved.hospital != null) state.hospital = asStr(saved.hospital);
    if (saved.dept != null) state.dept = asStr(saved.dept) || '康复医学科';
    if (saved.doctorTitle != null) state.doctorTitle = asStr(saved.doctorTitle);
    if (saved.supervisor != null) state.supervisor = asStr(saved.supervisor);
  }
  state.seedRemoved = asArr(saved && saved.seedRemoved).map(asStr);
  state.customScales = normalizeScaleDefs(saved && saved.customScales);
  seedScales();
  state.patients.forEach(normalizePatient);
  state.patients.forEach(fillNoteAuthors);
  // 恢复按患者键控的草稿桶，并剔除已不存在患者的残留草稿
  state.drafts = isObj(saved && saved.drafts) ? saved.drafts : {};
  const aliveIds = new Set(state.patients.map((p) => p.id));
  Object.keys(state.drafts).forEach((k) => { if (!aliveIds.has(k)) delete state.drafts[k]; });
  restoreDraft(state.currentId);   // 启动加载时把当前患者草稿回填内存，避免空快照覆盖桶
  // 首次加载演示数据时，自动生成鉴别诊断，演示"零人工"效果
  if (!saved || !(saved.patients && saved.patients.length)) {
    state.patients.forEach((p) => {
      if (!p.record.diffDx.items.length && DIFF_DX[p.record.diffDx.key]) {
        p.record.diffDx.items = ddxFromDict(p.record.diffDx.key);
      }
    });
  }
}
/* 病种 key → 病程生成器 / 出院模板 的映射 */
const DISEASE_TO_COMPOSE_CAT = {
  stroke: '脑卒中', neckback: '骨科', ortho: '骨科', geriatric: '老年病',
  spinal: '神经康复', parkinson: '神经康复', frozenShoulder: '骨科', knee: '骨科',
  ankleSprain: '骨科', chronicPain: '疼痛康复', dementia: '认知康复',
  cerebralPalsy: '神经康复', diabeticFoot: '血管康复', paraplegia: '神经康复', multipleSclerosis: '神经康复',
  tbi: '神经康复',
  tha: '骨科',
  tka: '骨科',
  rotatorCuff: '骨科',
  acl: '骨科',
  distalRadius: '骨科',
  handInjury: '骨科',
  amputation: '骨科',
  copd: '老年病',
  cardiac: '血管康复',
  facialPalsy: '神经康复',
  vestibular: '神经康复',
  peripheralNerve: '神经康复'
};
/* v1.37：19 个病种有了专用出院医嘱，映射改为直指自身键 */
const DISEASE_TO_DISCHARGE_TPL = {
  stroke: 'stroke', neckback: 'neckback', ortho: 'ortho', geriatric: 'geriatric',
  spinal: 'spinal', parkinson: 'parkinson', frozenShoulder: 'frozenShoulder', knee: 'knee',
  ankleSprain: 'ankleSprain', chronicPain: 'chronicPain', dementia: 'dementia',
  cerebralPalsy: 'cerebralPalsy', diabeticFoot: 'diabeticFoot', paraplegia: 'paraplegia', multipleSclerosis: 'multipleSclerosis',
  tbi: 'tbi',
  tha: 'tha',
  tka: 'tka',
  rotatorCuff: 'rotatorCuff',
  acl: 'acl',
  distalRadius: 'distalRadius',
  handInjury: 'handInjury',
  amputation: 'amputation',
  copd: 'copd',
  cardiac: 'cardiac',
  facialPalsy: 'facialPalsy',
  vestibular: 'vestibular',
  peripheralNerve: 'peripheralNerve'
};

function normalizePatient(p) {
  if (!isObj(p)) return;
  const ageN = Number(p.age);
  p.age = (p.age == null || p.age === '') ? '' : (Number.isFinite(ageN) ? ageN : '');
  ['name', 'gender', 'bed', 'mrn', 'status', 'diagShort', 'side'].forEach((k) => { p[k] = asStr(p[k]); });
  p.admitDate = normDate(p.admitDate);
  p.record = asObj(p.record);
  p.record.vitals = asObj(p.record.vitals, { t: '', p: '', r: '', bp: '', spo2: '' });
  p.record.tcm = asObj(p.record.tcm);
  p.record.ros = asObj(p.record.ros);   // 系统回顾（来自 bingli schema）
  p.record.pe = asObj(p.record.pe);     // 体格检查（来自 bingli schema）
  // 自由文本字段统一纠偏为字符串：畸形备份/旧数据可能带 number/object/array，
  // 否则下游 .trim()/.slice()/.replace() 会因真值类型不兜底而抛 TypeError
  ['chief', 'present', 'past', 'personal', 'family', 'allergy', 'neuro', 'plan', 'goalsShort', 'goalsLong']
    .forEach((k) => { p.record[k] = asStr(p.record[k]); });
  /* G3 康复处方明细：项目/频次/时长/执行治疗师结构化；旧数据无此字段为空数组，plan 自由文本保留为叙述兼容 */
  p.record.planItems = asArr(p.record.planItems).map((x) => {
    if (!isObj(x)) return { name: asStr(x), frequency: '', duration: '', therapist: '' };
    return { name: asStr(x.name), frequency: asStr(x.frequency), duration: asStr(x.duration), therapist: asStr(x.therapist) };
  });
  // 全局缓存病种 key，所有功能统一复用
  p.diseaseKey = detectDisease((p.record.present || '') + ' ' + (p.diagShort || '') + ' ' + (p.record.chief || ''));
  p.record.diffDx = asObj(p.record.diffDx, { key: p.diseaseKey, items: [] });
  p.record.diffDx.key = asStr(p.record.diffDx.key) || p.diseaseKey;
  p.record.diffDx.items = asArr(p.record.diffDx.items)
    .map((x) => {
      if (!isObj(x)) return { d: '', support: '', against: '', advice: '' };
      // 旧版 point 兼容迁入 support；against / advice 为三要素新增位
      return { d: asStr(x.d), support: asStr(x.support != null ? x.support : x.point), against: asStr(x.against), advice: asStr(x.advice) };
    });
  p.record.diagnoses = asArr(p.record.diagnoses).map(asStr);
  p.record.problems = asArr(p.record.problems).map(asStr);
  /* S2 辅助检查分格：旧版整段字符串迁入 other 兜底格；aux 为分格派生串，兼容旧读取点 */
  p.record.auxBoxes = asObj(p.record.auxBoxes);
  AUX_BOX_KEYS.forEach((k) => { p.record.auxBoxes[k] = asStr(p.record.auxBoxes[k]); });
  const legacyAux = asStr(p.record.aux);
  const legacyOnly = AUX_BOX_KEYS.every((k) => !(p.record.auxBoxes[k] || '').trim());
  if (legacyOnly && legacyAux.trim()) p.record.auxBoxes.other = legacyAux;
  p.record.aux = auxJoin(p.record.auxBoxes);
  /* S5 体格检查分段：旧版整段 exam 迁入 general 兜底段；exam 为分段派生串 */
  p.record.examParts = asObj(p.record.examParts);
  EXAM_SECTION_KEYS.forEach((k) => { p.record.examParts[k] = asStr(p.record.examParts[k]); });
  const legacyExam = asStr(p.record.exam);
  const examOnly = EXAM_SECTION_KEYS.every((k) => !(p.record.examParts[k] || '').trim());
  if (examOnly && legacyExam.trim()) p.record.examParts.general = legacyExam;
  p.record.exam = examPartsJoin(p.record.examParts);
  p.assessments = asArr(p.assessments).filter(isObj);
  p.notes = asArr(p.notes).filter(isObj)
    .map((n) => ({ id: asStr(n.id) || uid(), date: normDate(n.date) || todayISO(), author: asStr(n.author), type: NOTE_TYPES.indexOf(n.type) >= 0 ? n.type : 'daily', text: asStr(n.text), adverse: asStr(n.adverse) }));
  p.discharge = asObj(p.discharge, { date: '', summary: '', advice: [], followUp: '', templateKey: '', checked: [] });
  p.discharge.advice = asArr(p.discharge.advice).map(asStr);
  p.discharge.checked = asArr(p.discharge.checked).filter((x) => typeof x === 'number' && Number.isInteger(x));
  ['summary', 'followUp', 'dest', 'templateKey'].forEach((k) => { p.discharge[k] = asStr(p.discharge[k]); });
  p.discharge.date = normDate(p.discharge.date);
  p.assessments.forEach((a) => {
    a.date = normDate(a.date) || todayISO();
    // 先取旧值再重建容器：直接 a.mmt={} 会把已录入的肌力/肌张力读成缺省值，导致每次加载清零
    const prevMmt = asObj(a.mmt), prevMas = asObj(a.mas);
    a.mmt = {}; a.mas = {};
    MMT_GROUPS.forEach((g) => { const row = asArr(prevMmt[g], [0, 0]); a.mmt[g] = [clamp(asNum(row[0], 0), 0, 5), clamp(asNum(row[1], 0), 0, 5)]; });
    MAS_GROUPS.forEach((g) => { const row = asArr(prevMas[g], ['0', '0']); a.mas[g] = [masLevel(row[0]), masLevel(row[1])]; });
    const prevBs = asObj(a.brunnstrom);
    a.brunnstrom = { upper: bsStage(prevBs.upper), hand: bsStage(prevBs.hand), lower: bsStage(prevBs.lower) };
    a.barthel = asObj(a.barthel);
    let berg = asArr(a.berg, new Array(14).fill(0));
    berg = berg.slice(0, 14).concat(new Array(Math.max(0, 14 - berg.length)).fill(0)).map((v) => asNum(v, 0));
    a.berg = berg;
    a.mmse = asObj(a.mmse);
    a.vas = clamp(asNum(a.vas, 0), 0, 10);
    a.kouda = asNum(a.kouda, 1); a.holden = asNum(a.holden, 0);
    a.custom = asObj(a.custom);
  });
}

/* 从病种字典生成鉴别条目：兼容旧版 point 字段，迁入 support；against/advice 缺省留空 */
function ddxFromDict(key) {
  return (DIFF_DX[key] || []).map((x) => ({
    d: asStr(x.d),
    support: asStr(x.support != null ? x.support : x.point),
    against: asStr(x.against),
    advice: asStr(x.advice)
  }));
}

/* 病程记录作者缺失时补当前书写医师，避免落款空白 */
function fillNoteAuthors(p) {
  (p.notes || []).forEach((n) => { if (!asStr(n.author).trim()) n.author = state.doctor; });
}

/* 刷新当前患者的病种识别（诊断/现病史改变后调用） */
function refreshDiseaseKey(p) {
  p.diseaseKey = detectDisease((p.record.present || '') + ' ' + (p.diagShort || '') + ' ' + (p.record.chief || ''));
}

/* 按病种模板补全患者的空字段（已填的不覆盖） */
function fillEmptyFromTemplate(p, forceKey) {
  const key = forceKey || p.diseaseKey;
  const T = ADMIT_TEMPLATES[key];
  if (!T) return 0;
  let filled = 0;
  const setIfEmpty = (path, tplVal) => {
    if (tplVal == null) return;
    if (tplVal === '') return;
    const cur = getPath(p, path);
    if (!cur || (typeof cur === 'string' && !cur.trim())) {
      setPath(p, path, tplVal);
      filled++;
    }
  };
  setIfEmpty('record.chief', T.chief);
  setIfEmpty('record.present', T.present);
  setIfEmpty('record.past', T.past);
  setIfEmpty('record.personal', T.personal);
  setIfEmpty('record.family', T.family);
  setIfEmpty('record.allergy', T.allergy);
  // vitals 整组填空
  if (!p.record.vitals.bp && T.vitals) { p.record.vitals = clone(T.vitals); filled++; }
  setIfEmpty('record.exam', T.exam);
  setIfEmpty('record.neuro', T.neuro);
  // 诊断只填空的（当前还没诊断才用模板）
  if (!p.record.diagnoses.length && T.diagnoses) { p.record.diagnoses = T.diagnoses.slice(); filled++; }
  if (!p.record.problems.length && T.problems) { p.record.problems = T.problems.slice(); filled++; }
  setIfEmpty('record.goalsShort', T.goalsShort);
  setIfEmpty('record.goalsLong', T.goalsLong);
  setIfEmpty('record.plan', T.plan);
  // tcm 整组填空
  if (!p.record.tcm.tongueBody && T.tcm) { p.record.tcm = clone(T.tcm); filled++; }
  // 鉴别诊断
  if (!p.record.diffDx.items.length && DIFF_DX[key]) {
    p.record.diffDx = { key, items: ddxFromDict(key) };
    filled++;
  } else {
    p.record.diffDx.key = key;
  }
  p.diseaseKey = key;
  return filled;
}

/* 把 bingli 开源模板（record 对象）合并进我们的患者对象 p，只填空位不覆盖 */
function mergeBingliTemplate(p, tpl) {
  const R = tpl.record || {};
  let filled = 0;
  const setIfEmpty = (path, tplVal) => {
    if (!tplVal) return;
    if (typeof tplVal === 'string' && !tplVal.trim()) return;
    const cur = getPath(p, path);
    if (cur === undefined || cur === null || cur === '' || (typeof cur === 'string' && !cur.trim()) || (Array.isArray(cur) && cur.length === 0)) {
      setPath(p, path, tplVal);
      filled++;
    }
  };
  // 1. 主诉（bingli 的 basic.chiefComplaint 已经是完整主诉）
  const chief = R.basic && R.basic.chiefComplaint ? R.basic.chiefComplaint.replace(/（患侧）|（对侧）|（健侧）/g, '患侧') : '';
  if (chief) setIfEmpty('record.chief', chief);

  // 2. 现病史：拼接 hpi 10 个字段
  const HPI_LABELS = { onset: '起病', cause: '诱因', symptoms: '主要症状', relief: '缓解方式', evolution: '病情演变', accompanying: '伴随症状', negativeDiscriminating: '鉴别阴性', treatment: '诊疗经过', generalCondition: '一般情况', extra: '补充' };
  const hpiParts = [];
  if (R.hpi) Object.entries(R.hpi).forEach(([k, v]) => { if (v && String(v).trim() && HPI_LABELS[k]) hpiParts.push(String(v).trim()); });
  if (hpiParts.length) setIfEmpty('record.present', hpiParts.join('\n\n'));

  // 3. 既往史
  const pmhParts = [];
  if (R.pmh) {
    if (R.pmh.health) pmhParts.push('平素健康状况：' + R.pmh.health);
    if (R.pmh.diseaseDetail) pmhParts.push(R.pmh.diseaseDetail);
    const checked = R.pmh.diseaseChecks || {};
    const checkedNames = Object.entries(checked).filter(([, v]) => v).map(([k]) => k);
    if (checkedNames.length) pmhParts.push('疾病史：' + checkedNames.join('、'));
    if (R.pmh.longTermMeds) pmhParts.push('长期用药：' + R.pmh.longTermMeds);
    if (R.pmh.infection) pmhParts.push(R.pmh.infection);
    if (R.pmh.surgery) pmhParts.push('手术史：' + R.pmh.surgery);
    if (R.pmh.trauma) pmhParts.push('外伤史：' + R.pmh.trauma);
    if (R.pmh.transfusion) pmhParts.push('输血史：' + R.pmh.transfusion);
  }
  if (pmhParts.length) setIfEmpty('record.past', pmhParts.join('；'));

  // 4. 个人史
  const persParts = [];
  if (R.personal) {
    if (R.personal.residence) persParts.push('久居' + R.personal.residence);
    if (R.personal.smoking) persParts.push('吸烟史：' + R.personal.smoking + (R.personal.smokingAmount ? ' ' + R.personal.smokingAmount : ''));
    if (R.personal.drinking) persParts.push('饮酒史：' + R.personal.drinking + (R.personal.drinkingAmount ? ' ' + R.personal.drinkingAmount : ''));
    if (R.personal.drugs) persParts.push('毒物接触：' + R.personal.drugs);
    if (R.personal.environment) persParts.push(R.personal.environment);
    if (R.personal.occupationEnv) persParts.push('职业环境：' + R.personal.occupationEnv);
  }
  if (persParts.length) setIfEmpty('record.personal', persParts.join('；'));

  // 5. 家族史
  const famParts = [];
  if (R.family) {
    const fChecked = R.family.diseaseChecks || {};
    const fNames = Object.entries(fChecked).filter(([, v]) => v).map(([k]) => k);
    if (fNames.length) famParts.push('家族性疾病：' + fNames.join('、'));
    if (R.family.other) famParts.push(R.family.other);
    if (R.family.deceased) famParts.push(R.family.deceased);
    if (R.family.threeGeneration) famParts.push(R.family.threeGeneration);
  }
  if (famParts.length) setIfEmpty('record.family', famParts.join('；'));

  // 6. 过敏史
  if (R.pmh && R.pmh.allergy) setIfEmpty('record.allergy', R.pmh.allergy);
  else if (R.pmh && R.pmh.allergyReaction) {
    const aR = R.pmh.allergyReactionChecks || {};
    const aNames = Object.entries(aR).filter(([, v]) => v).map(([k]) => k);
    if (aNames.length) setIfEmpty('record.allergy', aNames.join('、') + '过敏，' + R.pmh.allergyReaction);
  }

  // 7. 一般查体：拼接 pe 各 group 的各 key 内容（取有值的）
  if (R.pe) {
    const peOrder = ['general', 'skin', 'head', 'neck', 'chest', 'abdomen', 'genital', 'spine', 'nervousPE'];
    const textParts = [];
    peOrder.forEach(gk => {
      const group = R.pe[gk];
      if (!group) return;
      if (typeof group !== 'object') return;
      // 有些是 flat object: { development: '发育正常', ... }
      Object.values(group).forEach(v => {
        if (typeof v === 'string' && v.trim()) textParts.push(v.trim());
        else if (v && typeof v === 'object' && v.text && v.text.trim()) textParts.push(v.text.trim());
      });
    });
    if (textParts.length) setIfEmpty('record.exam', textParts.join('；'));

    // vitals
    if (R.pe.vitals && typeof R.pe.vitals === 'object') {
      const vit = R.pe.vitals;
      const our = p.record.vitals;
      const map = { temperature: 't', pulse: 'p', respiration: 'r', sbp: 'bp', spo2: 'spo2' };
      Object.entries(map).forEach(([k, ourKey]) => {
        const tv = vit[k];
        if (tv && !our[ourKey]) { our[ourKey] = tv; filled++; }
      });
    }
  }

  // 8. 诊断（bingli 的 confirmed 可能是 ['诊断1', '诊断2']）
  if (R.diagnosis && Array.isArray(R.diagnosis.confirmed) && R.diagnosis.confirmed.length && !p.record.diagnoses.length) {
    p.record.diagnoses = R.diagnosis.confirmed.slice();
    filled++;
  }

  // 8.5 ROS 系统回顾（bingli 模板里 ros 是按系统分组的对象）
  if (R.ros && typeof R.ros === 'object' && Object.keys(R.ros).length && !Object.keys(p.record.ros || {}).length) {
    p.record.ros = JSON.parse(JSON.stringify(R.ros));
    filled++;
  }

  // 8.6 PE 体格检查各 group
  if (R.pe && typeof R.pe === 'object') {
    const peGroups = ['general', 'skin', 'head', 'neck', 'chest', 'abdomen', 'genital', 'spine', 'nervousPE'];
    let peCopied = false;
    peGroups.forEach(gk => {
      const gSrc = R.pe[gk];
      if (gSrc && typeof gSrc === 'object') {
        if (!p.record.pe[gk]) {
          p.record.pe[gk] = JSON.parse(JSON.stringify(gSrc));
          peCopied = true;
        }
      }
    });
    if (peCopied) filled++;
  }

  // 9. 治疗方案（从 soap 里拿）
  if (R.soap && R.soap.p && R.soap.p.individual) {
    setIfEmpty('record.plan', R.soap.p.individual);
  }

  // 10. 辅助检查（按类别归入分格；不再混入康复问题列表）
  if (R.auxiliary && Array.isArray(R.auxiliary.items) && R.auxiliary.items.length && !auxJoin(p.record.auxBoxes)) {
    p.record.auxBoxes = p.record.auxBoxes || {};
    R.auxiliary.items.forEach((i) => {
      const txt = (i.name || '') + (i.result ? '：' + i.result : '');
      if (!txt.trim()) return;
      const k = classifyAuxItem(txt);
      p.record.auxBoxes[k] = p.record.auxBoxes[k] ? p.record.auxBoxes[k] + '；' + txt : txt;
    });
    p.record.aux = auxJoin(p.record.auxBoxes);
    if (p.record.aux) filled++;
  }

  // 11. 模板 hint 写入 present 末尾（作为提示）
  if (tpl.hint) {
    const cur = p.record.present || '';
    if (!cur.includes('【提示】')) {
      p.record.present = cur + (cur ? '\n\n' : '') + '【提示】' + tpl.hint;
      filled++;
    }
  }

  return filled;
}

/* ---------------- 通用渲染 ---------------- */
function toast(msg) {
  const t = $('#toast');
  t.textContent = msg;
  t.classList.add('show');
  clearTimeout(t._timer);
  t._timer = setTimeout(() => t.classList.remove('show'), 2100);
}

function renderAll(keepScroll) {
  const snap = captureFocus();
  syncAppbarState(!!state.patients.length);
  if (!state.patients.length) { renderEmptyState(); restoreFocus(snap); return; }
  renderSwitch();
  renderRail();
  renderHead();
  renderTabs();
  renderView(keepScroll);
  renderAssistant();
  restoreFocus(snap);
}
/* 没有患者时，打印/导出点下去只会报错：直接置灰，避免误点 */
function syncAppbarState(hasPatient) {
  $$('.appbar-actions [data-action="print"], .appbar-actions [data-action="export-word"]').forEach((b) => {
    b.disabled = !hasPatient;
    b.setAttribute('aria-disabled', hasPatient ? 'false' : 'true');
  });
}

/* 没有任何患者时的界面：不渲染任何患者视图，只给一个明确的「新建」入口 */
function renderEmptyState() {
  renderDemoBanner();
  const cnt = $('#patientCount'); if (cnt) cnt.textContent = '0';
  const sw = $('#patientSwitch'); if (sw) sw.innerHTML = '<option>（暂无患者）</option>';
  const pl = $('#patientList');
  if (pl) pl.innerHTML = '<div class="rail-empty">还没有患者<br><button class="btn tiny solid" data-action="new-patient">新建患者</button></div>';
  const dh = $('#docHead');
  if (dh) dh.innerHTML = '<div class="empty-head">' +
    '<div class="empty-title">还没有患者档案</div>' +
    '<div class="empty-sub">点「新建患者」，填姓名和主要诊断，系统会按病种自动预填整套入院记录，你只需核对并改数字。</div>' +
    '<button class="btn solid" data-action="new-patient">新建第一位患者</button></div>';
  const v = $('#view'); if (v) v.innerHTML = '';
  const pv = $('#previewPane'); if (pv) { pv.innerHTML = ''; pv.className = 'preview-pane'; }
  const qi = $('#qcInline'); if (qi) { qi.innerHTML = ''; qi.className = 'qc-inline'; }
  const ai = $('#assistantBody');
  if (ai) ai.innerHTML = '<div class="blank" style="padding:18px 14px">有患者后，这里会显示查房语句、诊断参考与质控得分。</div>';
  const cd = $('#courseDot'); if (cd) cd.classList.remove('show');
  const ad = $('#assessDot'); if (ad) ad.classList.remove('show');
}

function renderSwitch() {
  const p = P();
  if (!p) return;
  $('#patientSwitch').innerHTML = state.patients.map((x) =>
    '<option value="' + x.id + '"' + (x.id === p.id ? ' selected' : '') + '>' + esc(x.name) + ' · ' + esc(x.bed) + '床 · ' + esc(x.diagShort) + '</option>'
  ).join('');
}

/* 当前是否为未改动的演示数据集：用来提示「这些不是你的病人」，避免误当真实病历打印或导出 */
function isDemoDeck() {
  if (!Array.isArray(state.patients) || state.patients.length !== INITIAL_PATIENTS.length) return false;
  const want = INITIAL_PATIENTS.map((p) => p.id).sort().join('|');
  const got = state.patients.map((p) => p.id).sort().join('|');
  return want === got;
}

function renderDemoBanner() {
  const el = $('#demoBanner');
  if (!el) return;
  const show = isDemoDeck() && !state.demoHintHidden;
  el.hidden = !show;
  if (!show) { el.innerHTML = ''; return; }
  el.innerHTML = '<div class="demo-title">这是 ' + state.patients.length + ' 份演示病人</div>' +
    '<div class="demo-text">不是你的真实病历，可以放心点开看。正式使用时先清空，再点「新建患者」录自己的病人。</div>' +
    '<div class="demo-actions">' +
      '<button class="btn tiny solid" data-action="clear-demo">清空演示，开始用</button>' +
      '<button class="btn tiny outline" data-action="dismiss-demo">我知道了</button>' +
    '</div>';
}

function renderRail() {
  const snap = captureFocus();
  const q = state.search.trim().toLowerCase();
  const list = state.patients.filter((p) => {
    const okFilter = state.filter === 'all' || p.status === state.filter;
    const hay = (p.name + p.bed + p.mrn + p.diagShort).toLowerCase();
    return okFilter && (!q || hay.indexOf(q) >= 0);
  });
  renderDemoBanner();
  $('#patientCount').textContent = list.length;
  const demo = isDemoDeck();
  $('#patientList').innerHTML = list.length ? list.map((p) => {
    const a = latest(p);
    // 没评过 Barthel 的显示"—"，不要在小卡片上写一个"0 分"
    const hasB = !!(a && isTouched(a, 'barthel'));
    const b = hasB ? barthelTotal(a) : 0;
    return '<div class="patient-card' + (p.id === state.currentId ? ' active' : '') + '" data-patient="' + esc(p.id) + '" role="button" tabindex="0">' +
      '<div class="pc-top"><span class="pc-name">' + esc(p.name) + '</span>' +
      (demo ? '<span class="pc-demo">演示</span>' : '') +
      '<span class="pc-status ' + esc(p.status) + '">' + esc(p.status) + '</span></div>' +
      '<div class="pc-sub"><span class="pc-meta">' + esc(p.gender) + ' · ' + esc(String(p.age)) + ' 岁</span>' +
      '<span class="pc-del" data-del-patient="' + esc(p.id) + '" title="删除这份病历">×</span></div>' +
      '<div class="pc-diag" title="' + esc(p.diagShort) + '">' + esc(p.diagShort) + '</div>' +
      '<div class="pc-foot"><span class="pc-bed">' + esc(p.bed) + ' 床 · ' + monthDay(p.admitDate) + ' 入院</span>' +
      (state.settings && state.settings.railScore === false ? '' :
        '<span class="bar-mini"><i style="width:' + b + '%"></i></span><span class="pc-score">' + (hasB ? b : '—') + '</span>') + '</div></div>';
  }).join('') : '<div class="blank" style="margin:10px 0">没有匹配的患者</div>';
  restoreFocus(snap);
}

function renderHead() {
  const p = P();
  if (!p) return;
  const a = latest(p);
  const qc = computeQC();
  const days = daysBetween(p.admitDate);
  $('#docHead').innerHTML = '<div class="doc-head-inner">' +
    '<div class="doc-avatar">' + esc(p.name.charAt(0)) + '</div>' +
    '<div style="min-width:0">' +
      '<div class="doc-name-row"><span class="doc-name">' + esc(p.name) + '</span>' +
        '<span class="doc-tag">' + esc(p.gender) + ' / ' + p.age + ' 岁</span>' +
        '<span class="doc-tag brand">' + esc(p.status) + '</span>' +
        (p.side ? '<span class="doc-tag">患侧：' + esc(p.side) + '</span>' : '') +
      '</div>' +
      '<div class="doc-meta">' +
        '<span>床号 <b>' + esc(p.bed) + '</b></span>' +
        '<span>住院号 <b>' + esc(p.mrn) + '</b></span>' +
        '<span>入院 <b>' + esc(p.admitDate) + '</b>（第 ' + (days + 1) + ' 天）</span>' +
        '<span>评估 <b>' + p.assessments.length + '</b> 次</span>' +
        '<span>病程 <b>' + p.notes.length + '</b> 条</span>' +
      '</div>' +
      '<div class="doc-diag">' + (p.record.diagnoses.length ? p.record.diagnoses.map((d) => '<span class="diag-pill">' + esc(d) + '</span>').join('') : '<span class="diag-pill" style="border-style:dotted;color:#9aa69f">尚未填写初步诊断</span>') + '</div>' +
    '</div>' +
    '<div class="doc-side"><div class="ring-wrap"><div class="ring" style="--v:' + qc.score + '"><b>' + qc.score + '</b></div>' +
      '<div class="ring-cap">病历质控<b>' + (qc.score >= 90 ? '完整' : qc.score >= 70 ? '待补充' : '缺项较多') + '</b></div></div></div>' +
  '</div>';
}

function renderTabs() {
  $$('#tabs .tab').forEach((t) => t.classList.toggle('active', t.dataset.tab === state.tab));
  const p = P();
  if (!p) {
    const qi0 = $('#qcInline'); if (qi0) { qi0.innerHTML = ''; qi0.className = 'qc-inline'; }
    const c0 = $('#courseDot'); if (c0) c0.classList.remove('show');
    const a0 = $('#assessDot'); if (a0) a0.classList.remove('show');
    return;
  }
  $('#courseDot').classList.toggle('show', p.notes.length === 0);
  $('#assessDot').classList.toggle('show', !latest(p));
  const qc = computeQC();
  const cls = qc.score >= 90 ? '' : qc.score >= 70 ? 'warn' : 'bad';
  $('#qcInline').className = 'qc-inline ' + cls;
  $('#qcInline').innerHTML = '<span>完整度 ' + qc.score + '%</span><span class="qc-bar"><i style="width:' + qc.score + '%"></i></span>';
}

/* ---------------- 视图路由 ---------------- */
function renderPreview(p) {
  const pane = $('#previewPane');
  if (!pane) return;
  if (state.tab === 'report') {
    pane.innerHTML = '<div class="preview-head"><span>解读草稿预览</span><button class="btn small outline" data-action="report-copy">复制解读稿</button><button class="btn small outline" data-action="report-word">导出 Word</button></div>' +
      '<div class="preview-body">' + reportHtml() + '</div>';
    pane.className = 'preview-pane mode-' + state.viewMode;
    const v = $('#view');
    if (v) v.className = 'view mode-' + state.viewMode;
    $$('#viewMode .vm-btn').forEach((b) => b.classList.toggle('active', b.dataset.vmode === state.viewMode));
    return;
  }
  pane.innerHTML = '<div class="preview-head"><span>实时成稿预览</span><button class="btn small outline" data-action="print">打印</button></div>' +
    '<div class="preview-body">' + printHtml(p) + '</div>';
  pane.className = 'preview-pane mode-' + state.viewMode;
  const v = $('#view');
  if (v) v.className = 'view mode-' + state.viewMode;
  $$('#viewMode .vm-btn').forEach((b) => b.classList.toggle('active', b.dataset.vmode === state.viewMode));
  $$('.preview-body [data-edit]').forEach((el) => { el.contentEditable = 'true'; });
}

function renderView(keepScroll) {
  const p = P();
  if (!p) return;
  const snap = captureFocus();
  const v = $('#view');
  const prev = v.scrollTop;
  if (state.tab === 'admit') v.innerHTML = viewAdmit(p);
  else if (state.tab === 'assess') v.innerHTML = viewAssess(p);
  else if (state.tab === 'course') v.innerHTML = viewCourse(p);
  else if (state.tab === 'report') v.innerHTML = viewReport(p);
  else v.innerHTML = viewDischarge(p);
  renderPreview(p);
  if (keepScroll === false) v.scrollTop = 0;
  else v.scrollTop = Math.min(prev, Math.max(0, v.scrollHeight - v.clientHeight));
  restoreFocus(snap);
}

function scrollToSec(sec) {
  if (!sec) return;
  delete state.collapsedSec[sec];
  const v = $('#view');
  const el = v.querySelector('[data-sec="' + sec + '"]');
  if (!el) return;
  v.scrollTop += el.getBoundingClientRect().top - v.getBoundingClientRect().top - 12;
  el.classList.add('flash');
  setTimeout(() => el.classList.remove('flash'), 1800);
}

function jumpToSec(sec) {
  const map = { chief: 'admit', exam: 'admit', tcm: 'admit', diag: 'admit', ddx: 'admit', goal: 'admit', assess: 'assess', course: 'course', discharge: 'discharge' };
  const tab = map[sec] || 'admit';
  state.tab = tab;
  renderTabs(); renderView(false); renderAssistant();
  if (tab === 'admit') setTimeout(() => scrollToSec(sec), 60);
}

/* ---------------- 报告解读（本地离线规则整理） ---------------- */
function reportNameMatch(line, name) {
  if (/^[A-Za-z][A-Za-z0-9/\-]*$/.test(name)) {
    const re = new RegExp('(^|[^A-Za-z0-9])' + name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '(?![A-Za-z0-9])', 'i');
    return re.test(line);
  }
  return line.includes(name);
}

/* 性别归一：返回 'm' / 'f' / ''（无法识别留空，回退合并区间） */
function normalizeGender(g) {
  const s = String(g == null ? '' : g).trim();
  if (/男|male|^m$/i.test(s)) return 'm';
  if (/女|female|^f$/i.test(s)) return 'f';
  return '';
}
/* 取指标对照区间：有性别区间且性别明确时取对应区间，否则回退合并区间；报告单自带范围在解析时再优先覆盖 */
function reportRangeFor(item, gender) {
  if (item.sexRange) {
    if (gender === 'm' && Array.isArray(item.sexRange.m)) return { low: item.sexRange.m[0], high: item.sexRange.m[1] };
    if (gender === 'f' && Array.isArray(item.sexRange.f)) return { low: item.sexRange.f[0], high: item.sexRange.f[1] };
  }
  return { low: item.low, high: item.high };
}

function parseReport(text, gender) {
  const out = [];
  const seen = new Set();
  if (!text || !text.trim()) return out;
  const g = normalizeGender(gender);
  // 别名扁平化：每个 (指标, 别名) 单独入列，按名称长度降序匹配，长名/全称优先，避免短别名抢先命中
  const flat = [];
  REPORT_LIBRARY.forEach((item) => item.names.forEach((name) => flat.push({ item, name })));
  flat.sort((a, b) => (b.name.length - a.name.length) || (REPORT_LIBRARY.indexOf(a.item) - REPORT_LIBRARY.indexOf(b.item)));
  text.split(/[\n\r;；]+/).forEach((rawLine) => {
    let l = rawLine.trim();
    if (!l) return;
    flat.forEach(({ item, name }) => {
      if (seen.has(item.key)) return;
      if (!reportNameMatch(l, name)) return;
      const idx = l.toLowerCase().indexOf(name.toLowerCase());
      const tail = l.slice(idx + name.length);
      // 命中后把该名称从行内抹成空格：避免同一行里更短的别名（如「血糖」「钙」）二次命中同一指标行
      l = l.slice(0, idx) + ' '.repeat(name.length) + l.slice(idx + name.length);
      const m = tail.match(/-?\d+(?:\.\d+)?/);
      if (!m) return;
      const val = Number(m[0]);
      const def = reportRangeFor(item, g);
      let low = def.low, high = def.high;
      let ref = def.low + '–' + def.high + (item.unit ? ' ' + item.unit : '');
      const rr = tail.match(/(\d+(?:\.\d+)?)\s*[-–~～]\s*(\d+(?:\.\d+)?)/);
      const lt = tail.match(/[<＜]\s*(\d+(?:\.\d+)?)/);
      const gt = tail.match(/[>＞]\s*(\d+(?:\.\d+)?)/);
      if (rr) { low = Number(rr[1]); high = Number(rr[2]); ref = rr[0] + (item.unit ? ' ' + item.unit : ''); }
      else if (lt) { high = Number(lt[1]); low = def.low >= high ? 0 : def.low; ref = '<' + lt[1] + (item.unit ? ' ' + item.unit : ''); }
      else if (gt) { low = Number(gt[1]); high = def.high; ref = '>' + gt[1] + (item.unit ? ' ' + item.unit : ''); }
      let dir = 'ok';
      if (val < low) dir = 'low'; else if (val > high) dir = 'high';
      if (/↑|偏高|升高|增高/.test(tail)) dir = dir === 'low' ? 'low' : 'high';
      if (/↓|偏低|降低/.test(tail)) dir = dir === 'high' ? 'high' : 'low';
      seen.add(item.key);
      out.push({ key: item.key, name: item.names[0], unit: item.unit, val, low, high, ref, dir, cat: item.cat, note: item.note });
    });
  });
  return out;
}

function reportDirLabel(dir) { return dir === 'high' ? '偏高' : dir === 'low' ? '偏低' : '正常'; }
function reportDirCls(dir) { return dir === 'high' ? 'bad' : dir === 'low' ? 'warn' : 'ok'; }

function reportHtml() {
  const items = state.reportParsed;
  if (!items.length) {
    return '<div class="rp-empty">粘贴检验 / 检查报告文字并点击「识别提取」后，这里生成本地解读草稿。<br>仅做指标整理与提示，不构成诊断或治疗建议。</div>';
  }
  const high = items.filter((x) => x.dir === 'high').length;
  const low = items.filter((x) => x.dir === 'low').length;
  const ok = items.length - high - low;
  const cats = [...new Set(items.map((x) => x.cat))];
  let body = '<div class="rp-summary">共识别 <b>' + items.length + '</b> 项：偏高 <b class="bad">' + high + '</b> · 偏低 <b class="warn">' + low + '</b> · 正常 <b class="ok">' + ok + '</b></div>';
  body += '<div class="rp-disclaimer">本稿为本地离线整理的指标对照与健康提示，不构成诊断结论、治疗方案或用药建议；异常项请结合症状、病史并咨询相应专科医生，最终以报告单标注与医生判断为准。</div>';
  cats.forEach((cat) => {
    body += '<h2 data-sec="report">' + esc(cat) + '</h2>';
    items.filter((x) => x.cat === cat).forEach((x) => {
      const adv = x.dir === 'high' ? '结果高于常用参考区间，建议复查并结合症状咨询相应专科医生。'
        : x.dir === 'low' ? '结果低于常用参考区间，建议复查并结合症状咨询医生。'
        : '结果在常用参考区间内，仍以报告单标注为准。';
      body += '<div class="rp-item"><div class="rp-item-top"><span class="rp-name">' + esc(x.name) + '</span>' +
        '<span class="rp-val">' + x.val + (x.unit ? ' ' + esc(x.unit) : '') + '</span>' +
        '<span class="rp-tag ' + reportDirCls(x.dir) + '">' + reportDirLabel(x.dir) + '</span></div>' +
        '<div class="rp-ref">参考：' + esc(x.ref) + '</div><div class="rp-note">' + esc(x.note) + '</div><div class="rp-adv">' + adv + '</div></div>';
    });
  });
  return body;
}

function viewReport(p) {
  const items = state.reportParsed;
  const rows = items.length ? items.map((x) =>
    '<tr><td>' + esc(x.name) + '</td><td><b>' + x.val + '</b> ' + (x.unit ? esc(x.unit) : '') + '</td><td>' + esc(x.ref) + '</td><td><span class="rp-tag ' + reportDirCls(x.dir) + '">' + reportDirLabel(x.dir) + '</span></td><td>' + esc(x.cat) + '</td></tr>'
  ).join('') : '<tr><td colspan="5" class="rp-empty-cell">尚未识别到指标，请粘贴报告文字后点击「识别提取」。</td></tr>';
  return '<div class="sheet">' +
    '<div class="sheet-head"><h3>检验检查报告解读 · 本地离线整理</h3><span class="sheet-no">不上传网络</span></div>' +
    '<div class="parse-paste"><div class="pp-row"><span class="pp-label">📋 粘贴报告文字</span><span class="pp-hint">支持血常规、肝肾功能、电解质、血糖血脂、炎症与凝血等常用指标；仅本地规则提取</span></div>' +
    '<textarea id="reportInput" rows="5" placeholder="示例：&#10;白细胞 6.2 10^9/L（3.5–9.5）&#10;血红蛋白 108 g/L（115–175）↓&#10;空腹血糖 7.2 mmol/L（3.9–6.1）↑&#10;低密度脂蛋白 3.8 mmol/L（&lt;3.4）">'+esc(state.reportDraft)+'</textarea>' +
    '<div class="pp-actions"><button class="btn small solid" data-action="report-parse">⚡ 识别提取</button>' +
    '<button class="btn small outline" data-action="report-clear">清空</button>' +
    (items.length ? '<button class="btn small outline" data-action="report-to-aux">指标摘要写入辅助检查</button><button class="btn small outline" data-action="report-to-summary">并入出院小结</button>' : '') +
    '<span class="hint">未在字典内的项目请人工核对，系统不臆断结果</span></div></div>' +
    '<div class="rp-table-wrap"><table class="rp-table"><thead><tr><th>指标</th><th>结果</th><th>参考范围</th><th>判定</th><th>分类</th></tr></thead><tbody>' + rows + '</tbody></table></div>' +
  '</div>';
}

/* ---------------- 入院记录 ---------------- */
function field(label, path, value, opts) {
  opts = opts || {};
  const type = opts.type || 'text';
  const req = opts.req ? '<span class="req">*</span>' : '';
  const cls = 'field' + (opts.wide ? ' wide' : '');
  if (type === 'textarea') {
    return '<div class="' + cls + '"><label>' + label + req + '<button class="voice-btn" data-voice data-target="' + path + '" title="语音输入（需 Chrome/Edge）">🎤</button></label>' +
      '<textarea data-bind="' + path + '" rows="' + (opts.rows || 3) + '" placeholder="' + esc(opts.ph || '') + '">' + esc(value || '') + '</textarea></div>';
  }
  if (type === 'select') {
    return '<div class="' + cls + '"><label>' + label + req + '</label><select data-bind="' + path + '">' +
      opts.options.map((o) => '<option value="' + esc(o) + '"' + (String(value) === String(o) ? ' selected' : '') + '>' + esc(o) + '</option>').join('') +
      '</select></div>';
  }
  return '<div class="' + cls + '"><label>' + label + req + '</label><input type="' + type + '" data-bind="' + path + '" value="' + esc(value || '') + '" placeholder="' + esc(opts.ph || '') + '"></div>';
}

/* 治疗项快速选用面板：chips 点选 + 批量粘贴匹配去重；未命中项显式列出（K10） */
/* S5 现病史多候选：当前病种模板主候选 + 备选候选，点选填入后仍可修改 */
function presentCandPanel(p) {
  const T = ADMIT_TEMPLATES[p.diseaseKey] || {};
  const cands = [T.present, T.presentAlt].filter((x) => x && String(x).trim());
  if (cands.length < 2) return '';
  return '<div class="phrase-panel"><div class="phrase-head">现病史候选（点选填入，可再修改）</div><div class="pick-row">' +
    cands.map((c, i) => '<button class="pick" data-action="present-cand" data-text="' + esc(c) + '">候选 ' + (i + 1) + '</button>').join('') +
    '</div></div>';
}

/* 参考病例：按当前病种展示典型病例（支持同一病种多份变异病例；只读，不写入病历） */
function casePanel(p) {
  if (typeof CASE_LIBRARY === 'undefined') return '';
  const key = p.diseaseKey || detectDisease((p.record.present || '') + ' ' + (p.diagShort || ''));
  const list = CASE_LIBRARY.filter((x) => x.key === key);
  if (!list.length) return '';
  const line = (label, text) => text ? '<div class="case-line"><b>' + label + '</b><span>' + esc(text) + '</span></div>' : '';
  const one = (c, i) => '<div class="case-block">' +
    '<div class="case-head"><span class="case-idx">病例 ' + (i + 1) + '</span>' +
    '<span class="case-title">' + esc(c.title) + '</span>' +
    (c.variant ? '<span class="case-variant">' + esc(c.variant) + '</span>' : '') +
    '</div><div class="case-meta-line">' + esc(c.meta) + '<button class="case-to" data-action="case-to-patient" data-case="' + CASE_LIBRARY.indexOf(c) + '">用此病例新建患者</button>' + '</div>' +
    line('主诉', c.chief) + line('现病史', c.hpi) + line('查体', c.exam) +
    line('评定', c.assess) + line('诊断', c.diag) + line('方案', c.plan) + line('转归', c.outcome) +
    (c.tip ? '<div class="case-tip">书写要点：' + esc(c.tip) + '</div>' : '') +
    '</div>';
  const first = list[0];
  return '<details class="case-panel"><summary><span class="case-sum-title">参考病例</span>' +
    '<span class="case-sum-name">' + esc(first.title) + (list.length > 1 ? ' 等 ' + list.length + ' 份' : '') + '</span>' +
    '<span class="case-sum-meta">' + esc(first.meta) + '</span>' +
    '<span class="case-sum-hint">点开对照书写</span></summary>' +
    '<div class="case-body">' + list.map(one).join('') +
    '<div class="case-foot">示例病例，数值与疗程仅供参考，使用时请按实际患者修改</div>' +
    '</div></details>';
}

/* 用参考病例生成一份可编辑的病历初稿：不改动病例库，只新建患者 */
function caseToPatient(idx) {
  const c = (typeof CASE_LIBRARY !== 'undefined') ? CASE_LIBRARY[idx] : null;
  if (!c) return;
  const gender = /女/.test(c.meta) ? '女' : '男';
  const ageM = /(\d{1,3})\s*岁/.exec(c.meta);
  const p = {
    id: uniquePatientId(), name: '示例·' + (c.variant || c.title.replace(/（.*?）/g, '').replace(/\s/g, '').slice(0, 8)), gender,
    age: ageM ? Number(ageM[1]) : '', bed: '—', mrn: 'MZ-' + Date.now().toString().slice(-6),
    dept: '康复医学科', status: '住院', admitDate: todayISO(),
    diagShort: (c.diag || '').split('；')[0].replace(/（.*?）/g, '').trim(),
    side: /左侧/.test(c.title) ? '左' : '右', phone: '',
    record: {
      chief: c.chief || '', present: c.hpi || '', past: '', personal: '', family: '', allergy: '',
      vitals: { t: '', p: '', r: '', bp: '', spo2: '' },
      exam: c.exam || '', neuro: c.assess || '',
      diagnoses: (c.diag || '').split('；').map((x) => x.trim()).filter(Boolean),
      problems: [], goalsShort: '', goalsLong: '', plan: c.plan || '', tcm: {}
    },
    assessments: [], notes: [],
    discharge: { date: '', summary: '', advice: [], checked: [], followUp: '', templateKey: '' }
  };
  normalizePatient(p);
  p.diseaseKey = c.key;
  state.patients.unshift(p);
  selectPatient(p.id);
  state.tab = 'admit';
  closeModal();
  scheduleSave(); renderAll();
  toast('已按参考病例新建患者，请核对评定数据与日期');
}

function planPhrasePanel(planText) {
  const cur = planText || '';
  const cats = [];
  PLAN_PHRASES.forEach((x) => { if (cats.indexOf(x.cat) < 0) cats.push(x.cat); });
  const chips = cats.map((cat) =>
    '<span class="pick-cat">' + esc(cat) + '</span>' +
    PLAN_PHRASES.filter((x) => x.cat === cat).map((x) => {
      const on = planHasPhrase(cur, x.full);
      return '<button class="pick' + (on ? ' on' : '') + '" data-plan-phrase="' + esc(x.full) + '">' + esc(x.full) + '</button>';
    }).join('')
  ).join('');
  const miss = state.planMissed || [];
  const statusHtml = miss.length
    ? '<div class="phrase-status warn">未命中（请人工补录或核对库内名称）：' + miss.map(esc).join('、') + '</div>'
    : '<div class="phrase-status">仅规范项目名称；频次、时长与剂量请在上方方案文本中按医嘱人工填写。</div>';
  state.planMissed = [];
  return '<div class="phrase-panel">' +
    '<div class="phrase-head"><b>治疗项快速选用</b><span>点选追加 / 取消；也可批量粘贴，自动匹配、去重并归一全称</span></div>' +
    '<div class="pick-row">' + chips + '</div>' +
    '<div class="phrase-import"><textarea id="planPaste" rows="2" placeholder="批量粘贴治疗项，顿号 / 逗号 / 分号 / 换行分隔，如：偏瘫训练、步态训练、理疗、针灸"></textarea>' +
    '<button class="btn small solid" data-action="plan-import">匹配并写入</button></div>' +
    statusHtml + '</div>';
}

/* G3 康复处方明细表：项目 / 频次 / 单次时长 / 执行治疗师；结构化台账，plan 自由文本仍保留为叙述 */
function planItemsPanel(items) {
  const list = Array.isArray(items) ? items : [];
  const opts = ['', ...FREQ_OPTIONS];
  const head = '<div class="pi-row pi-head"><span>治疗项目</span><span>频次</span><span>时长(min)</span><span>执行治疗师</span><span></span></div>';
  const rows = list.map((it, i) =>
    '<div class="pi-row">' +
      '<input list="piItemList" data-pi="name" data-i="' + i + '" value="' + esc(it.name || '') + '" placeholder="项目名称，可从建议项选择">' +
      '<select data-pi="frequency" data-i="' + i + '">' + opts.map((o) => '<option value="' + esc(o) + '"' + (it.frequency === o ? ' selected' : '') + '>' + esc(o || '—') + '</option>').join('') + '</select>' +
      '<input data-pi="duration" data-i="' + i + '" value="' + esc(it.duration || '') + '" placeholder="如 30" inputmode="numeric">' +
      '<input data-pi="therapist" data-i="' + i + '" value="' + esc(it.therapist || '') + '" placeholder="治疗师姓名">' +
      '<button class="rm" data-action="remove-plan-item" data-i="' + i + '" title="删除">×</button>' +
    '</div>').join('');
  const datalist = '<datalist id="piItemList">' + PLAN_PHRASES.map((x) => '<option value="' + esc(x.full) + '">').join('') + '</datalist>';
  return '<div class="plan-items"><div class="pi-head"><b>处方明细</b><span>项目 / 频次 / 单次时长 / 执行治疗师；剂量与医嘱以正式处方为准</span>' +
    '<button class="add-inline" data-action="add-plan-item">+ 添加项目</button></div>' +
    (list.length ? head + rows : '<div class="phrase-status">暂无结构化处方项目；可点上方「添加项目」逐条录入，或继续在方案文本中书写。</div>') + datalist + '</div>';
}

/* =============== ROS 系统回顾 渲染 =============== */
function renderROS(r) {
  if (typeof BINGLI_SCHEMA === 'undefined') return '';
  const groups = BINGLI_SCHEMA.ROS || [];
  const ros = r.ros || {};

  const groupHtml = groups.map(g => {
    const sysData = ros[g.key] || {};
    // 统计本组状态
    let posCount = 0, negCount = 0;
    Object.values(sysData).forEach(v => {
      if (v && v.checked) posCount++;
      else if (v && v.negative) negCount++;
    });
    const statusBadge = posCount > 0
      ? '<span class="ros-badge pos">' + posCount + ' 阳性</span>'
      : negCount > 0
        ? '<span class="ros-badge neg">全阴性</span>'
        : '<span class="ros-badge empty">未关注</span>';

    const symHtml = g.symptoms.map(s => {
      const cur = sysData[s.key] || {};
      const isPos = cur.checked;
      const isNeg = cur.negative;
      const cls = 'ros-sym' + (isPos ? ' pos' : isNeg ? ' neg' : '');
      const mark = isPos ? '✓' : isNeg ? '○' : '·';
      const detailInput = (isPos && s.detail)
        ? '<input class="ros-detail" data-ros-detail="' + g.key + '.' + s.key + '" value="' + esc(cur.detail || '') + '" placeholder="' + esc(s.detail) + '">'
        : '';
      return '<div class="' + cls + '" data-ros-sym="' + g.key + '.' + s.key + '" title="' + esc(s.label) + '">' +
        '<span class="ros-mark">' + mark + '</span>' +
        '<span class="ros-label">' + esc(s.label) + '</span>' +
        detailInput +
      '</div>';
    }).join('');

    return '<div class="ros-group">' +
      '<div class="ros-group-head" data-ros-toggle="' + g.key + '">' +
        '<span class="ros-arrow">▼</span>' +
        '<span class="ros-name">' + esc(g.name) + '</span>' +
        statusBadge +
      '</div>' +
      '<div class="ros-group-body" data-ros-body="' + g.key + '">' + symHtml + '</div>' +
    '</div>';
  }).join('');

  return '<div class="section-hint">点症状切换：未关注 → 阳性（✓） → 阴性（○）→ 未关注。阳性且 schema 有 detail 字段时可填细节。</div>' +
    '<div class="ros-wrap">' + groupHtml + '</div>' +
    '<div style="margin-top:8px;display:flex;gap:8px;flex-wrap:wrap">' +
      '<button class="btn small outline" data-action="ros-all-negative">全部标记阴性</button>' +
      '<button class="btn small outline" data-action="ros-clear">清空全部</button>' +
      '<button class="btn small solid" data-action="ros-insert-history">阳性症状写入现病史末尾</button>' +
    '</div>';
}

/* =============== PE 体格检查 渲染 =============== */
function peItemHtml(gKey, it, curVal) {
  const opts = it.options || [];
  const tip = it.tip ? '<details class="pe-tip"><summary>操作提示</summary><p>' + esc(it.tip) + '</p></details>' : '';
  // 长语句选项在窄栏里会被原生 select 截断，加 title 让鼠标悬停能看到全文
  const ctl = opts.length
    ? '<select class="pe-select" data-pe="' + gKey + '.' + it.key + '" title="' + esc(curVal) + '">' +
        opts.map(o => '<option value="' + esc(o) + '"' + (curVal === o ? ' selected' : '') + '>' + esc(o) + '</option>').join('') +
      '</select>'
    : '<input class="pe-input" data-pe="' + gKey + '.' + it.key + '" value="' + esc(curVal) + '" placeholder="' + esc(it.default || '') + '">';
  return '<div class="pe-item">' +
    '<label class="pe-label">' + esc(it.label) + '</label>' +
    ctl + tip +
  '</div>';
}

function renderPECommon(r) {
  if (typeof BINGLI_SCHEMA === 'undefined') return '';
  const groups = BINGLI_SCHEMA.PE_COMMON || [];
  const pe = r.pe || {};

  const groupHtml = groups.map(g => {
    const gData = pe[g.key] || {};
    const joinWith = g.joinWith || '。';
    const itemHtml = g.items.map(it => {
      const curVal = gData[it.key] || it.default || '';
      return peItemHtml(g.key, it, curVal);
    }).join('');
    return '<div class="pe-group">' +
      '<div class="pe-group-head">' + esc(g.name) + '</div>' +
      '<div class="pe-group-body" data-pe-group="' + g.key + '">' + itemHtml + '</div>' +
    '</div>';
  }).join('');

  return '<div class="pe-wrap">' + groupHtml + '</div>' +
    '<div style="margin-top:8px;display:flex;gap:8px;flex-wrap:wrap">' +
      '<button class="btn small solid" data-action="pe-gen-exam-text">⚡ 生成查体文本</button>' +
      '<span class="hint" style="font-size:11px;color:var(--faint)">一般查体写入体格检查段；专科阳性/异常项写入专科查体段，默认阴性不逐条罗列</span>' +
    '</div>';
}

/* 专科查体（神经/骨科等 PE_SPECIAL）：复用 data-pe 回写，每项附操作步骤提示 */
function renderPESpecial(r) {
  if (typeof BINGLI_SCHEMA === 'undefined' || !BINGLI_SCHEMA.PE_SPECIAL) return '';
  const pe = r.pe || {};
  const groups = Object.keys(BINGLI_SCHEMA.PE_SPECIAL)
    .map(k => ({ key: k, ...BINGLI_SCHEMA.PE_SPECIAL[k] }))
    .filter(g => (g.items || []).some(it => it.tip));
  const groupHtml = groups.map(g => {
    const gData = pe[g.key] || {};
    const itemHtml = (g.items || []).map(it => {
      const curVal = gData[it.key] || it.default || '';
      return peItemHtml(g.key, it, curVal);
    }).join('');
    return '<div class="pe-group wide">' +
      '<div class="pe-group-head">' + esc(g.name) + '</div>' +
      '<div class="pe-group-body cols2" data-pe-group="' + g.key + '">' + itemHtml + '</div>' +
    '</div>';
  }).join('');
  return '<div class="pe-section-head">专科特殊检查（神经 / 骨科等，点「操作提示」查看步骤与判读）</div>' +
    '<div class="pe-wrap">' + groupHtml + '</div>';
}

/* =============== ROS → 文字拼接（打印/导出用） =============== */
function rosToText(ros) {
  if (!ros) return '';
  if (typeof BINGLI_SCHEMA === 'undefined') return '';
  const parts = [];
  BINGLI_SCHEMA.ROS.forEach(g => {
    const sys = ros[g.key];
    if (!sys) return;
    const pos = [];
    const neg = [];
    g.symptoms.forEach(s => {
      const v = sys[s.key];
      if (v && v.checked) pos.push(s.label + (v.detail ? '（' + v.detail + '）' : ''));
      else if (v && v.negative) neg.push(s.label);
    });
    if (pos.length) parts.push(g.name + '：' + pos.join('、') + '阳性');
    else if (neg.length) parts.push(g.name + '：' + neg.join('、') + '阴性');
  });
  return parts.join('；');
}

/* =============== PE → 文字拼接 =============== */
function peGroupToText(pe, groupKey) {
  if (!pe) return '';
  if (typeof BINGLI_SCHEMA === 'undefined') return '';
  const common = (BINGLI_SCHEMA.PE_COMMON || []).find(x => x.key === groupKey);
  const special = BINGLI_SCHEMA.PE_SPECIAL ? BINGLI_SCHEMA.PE_SPECIAL[groupKey] : null;
  const g = common || special;
  if (!g) return '';
  const gData = pe[groupKey] || {};
  const joinWith = g.joinWith || '。';
  const items = [];
  (g.items || []).forEach(it => {
    const v = gData[it.key];
    if (v && v !== it.default) items.push(String(v).trim());
    else if (it.default && (!v || v === it.default)) items.push(it.default);
  });
  return items.join(joinWith);
}
function peCommonText(pe) {
  if (!pe) return '';
  if (typeof BINGLI_SCHEMA === 'undefined') return '';
  const order = ['general', 'skin', 'head', 'neck', 'chest', 'abdomen', 'genital', 'spine', 'nervousPE'];
  return order.map(k => peGroupToText(pe, k)).filter(Boolean).join('；');
}
/* 专科查体文本：只罗列被改判为非默认（异常/阳性）的项；未改动的默认阴性不逐条写入病历。 */
function peSpecialText(pe) {
  if (!pe || typeof BINGLI_SCHEMA === 'undefined' || !BINGLI_SCHEMA.PE_SPECIAL) return '';
  const blocks = Object.entries(BINGLI_SCHEMA.PE_SPECIAL).map(([gk, g]) => {
    const gData = pe[gk] || {};
    const abnormal = (g.items || []).filter(it => {
      const v = (gData[it.key] || '').trim();
      return v && (!it.default || v !== it.default);
    });
    if (!abnormal.length) return '';
    return g.name + '：' + abnormal.map(it => String(gData[it.key]).trim()).join('；');
  }).filter(Boolean);
  return blocks.join('；');
}
function peToText(pe) {
  const c = peCommonText(pe), s = peSpecialText(pe);
  return [c, s].filter(Boolean).join('；');
}

const ADMIT_SECTIONS = [
  { key: 'basic', title: '基本信息' },
  { key: 'chief', title: '主诉病史' },
  { key: 'ros', title: '系统回顾' },
  { key: 'exam', title: '查体' },
  { key: 'tcm', title: '中医四诊' },
  { key: 'diag', title: '初步诊断' },
  { key: 'ddx', title: '鉴别诊断' },
  { key: 'goal', title: '问题目标' }
];

function secStatus(p, secKey) {
  const qc = computeQC();
  const items = qc.checks.filter((c) => c.sec === secKey);
  if (!items.length) return null;
  return items.every((c) => c.pass);
}

function secBlock(secKey, idx, title, body, filled) {
  const collapsed = !!state.collapsedSec[secKey];
  const dot = filled == null ? '' : '<span class="sec-dot ' + (filled ? 'ok' : 'todo') + '"></span>';
  return '<div class="section' + (collapsed ? ' collapsed' : '') + '" data-sec="' + secKey + '">' +
    '<h4 class="section-title" data-sec-toggle="' + secKey + '"><span class="idx">' + idx + '</span>' + esc(title) + dot +
    '<span class="sec-arrow">' + (collapsed ? '▸' : '▾') + '</span></h4>' +
    '<div class="sec-body">' + body + '</div></div>';
}

function admitNav(p) {
  return '<div class="admit-nav">' + ADMIT_SECTIONS.map((s) => {
    const st = secStatus(p, s.key);
    return '<button class="nav-chip' + (st == null ? '' : st ? ' ok' : ' todo') + '" data-nav-sec="' + s.key + '">' +
      (st == null ? '' : '<span class="sec-dot ' + (st ? 'ok' : 'todo') + '"></span>') + esc(s.title) + '</button>';
  }).join('') + '</div>';
}

/* 专科查体里是否混进了当前评估摘要：只认"与当前评定叙事完全一致"的那一段，避免误删医生自己写的话 */
function neuroScaleLeak(p) {
  const a = latest(p);
  if (!a || !p.record) return false;
  const nar = assessmentNarrative(p, a);
  const neuro = (p.record.neuro || '').replace(/\s+/g, ' ');
  return !!nar && neuro.indexOf(nar.replace(/\s+/g, ' ')) >= 0;
}

function viewAdmit(p) {
  const r = p.record, v = r.vitals, tcm = r.tcm || {};
  const vitals = [['t', '体温', '℃'], ['p', '脉搏', '次/分'], ['r', '呼吸', '次/分'], ['bp', '血压', 'mmHg'], ['spo2', '血氧', '%']]
    .map(([k, label, unit]) => '<div class="vital"><label>' + label + '</label><div class="vrow"><input data-bind="record.vitals.' + k + '" value="' + esc(v[k] || '') + '" inputmode="decimal"><span class="unit">' + unit + '</span></div></div>').join('');

  return '<div class="sheet">' +
    '<div class="sheet-head"><h3>康 复 医 学 科 入 院 记 录</h3><span class="sheet-no">NO. ' + esc(p.mrn) + '</span></div>' +
    '<div class="sheet-sub"><span>姓名 ' + esc(p.name) + '　' + esc(p.gender) + '　' + p.age + ' 岁　床号 ' + esc(p.bed) + '</span><span>入院日期 ' + esc(p.admitDate) + '</span></div>' +

    admitNav(p) +

    '<div class="parse-paste"><div class="pp-row"><span class="pp-label">📋 粘贴病例智能识别回填</span><span class="pp-hint">自动抽取性别、年龄、患侧、主诉、现病史、既往史、诊断；仅填空字段，已填内容不覆盖</span></div>' +
      '<textarea id="parseInput" rows="2" placeholder="把出院小结 / 转诊记录 / 门诊病历等文字粘贴到这里…">' + esc(state.parseDraft) + '</textarea>' +
      '<div class="pp-actions"><button class="btn small solid" data-action="parse-paste">⚡ 识别并回填</button>' +
      '<span class="hint" id="parseHint">识别后会列出本次填入了哪些项</span></div></div>' +

    (typeof TEMPLATES_BINGLI !== 'undefined' ?
    '<div class="bingli-template-bar" style="display:flex;flex-wrap:wrap;gap:8px 8px;align-items:center;padding:8px 12px;background:#faf6ee;border:1px dashed #c9a76a;border-radius:8px;margin-bottom:14px">' +
      '<svg viewBox="0 0 24 24" class="ic" style="width:16px;height:16px;color:#c9a76a"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/></svg>' +
      '<span style="font-size:12px;color:#6b5222;white-space:nowrap">套用现成病历模板（来自 bingli 开源 57 例）：</span>' +
      '<select id="bingliTplSelect" style="flex:1 1 160px;min-width:120px;border:1px solid #c9a76a;border-radius:6px;padding:4px 8px;font-size:12px;background:#fff;outline:none">' +
        '<option value="">— 选一份标准病例（只填空位）—</option>' +
        (() => {
          const byDept = {};
          TEMPLATES_BINGLI.forEach(t => {
            byDept[t.dept] = byDept[t.dept] || [];
            byDept[t.dept].push(t);
          });
          const deptName = { cardiology:'心内科', nephrology:'肾内科', hematology:'血液科', surgery:'外科', respiratory:'呼吸内科', psychiatry:'精神科', digestive:'消化内科', endocrinology:'内分泌科', neurology:'神经内科', gynecology:'妇科', pediatrics:'儿科', emergency:'急诊', obstetrics:'产科' };
          return Object.keys(byDept).map(d =>
            '<optgroup label="' + (deptName[d] || d) + '">' +
              byDept[d].map(t => '<option value="' + t.key + '">' + esc(t.name) + '</option>').join('') +
            '</optgroup>'
          ).join('');
        })() +
      '</select>' +
      '<span style="display:inline-flex;flex-wrap:wrap;align-items:center;gap:4px 8px;flex-shrink:0;max-width:100%">' +
        '<button class="btn small solid" data-action="apply-bingli-template" style="white-space:nowrap">⚡ 套用（只填空位）</button>' +
        '<span class="hint" style="font-size:11px;color:#996;font-style:italic;white-space:nowrap">已填字段不会被覆盖</span>' +
      '</span>' +
    '</div>' : '') +

    secBlock('basic', '01', '基本信息',
      '<div class="form-grid three">' +
        field('姓名', 'name', p.name) + field('性别', 'gender', p.gender, { type: 'select', options: ['男', '女'] }) +
        field('年龄', 'age', p.age, { type: 'number' }) +
        field('床号', 'bed', p.bed) + field('住院号', 'mrn', p.mrn) +
        field('入院日期', 'admitDate', p.admitDate, { type: 'date' }) +
        field('患者状态', 'status', p.status, { type: 'select', options: ['住院', '门诊', '已出院'] }) +
        field('患侧', 'side', p.side, { type: 'select', options: ['', '左', '右', '双侧'] }) +
        field('联系电话', 'phone', p.phone) +
        field('主要诊断（简）', 'diagShort', p.diagShort, { wide: true }) +
      '</div>',
      !!(p.name && p.gender && p.age)) +

    secBlock('chief', '02', '主诉与病史',
      '<div class="form-grid one">' +
        field('主诉', 'record.chief', r.chief, { type: 'textarea', rows: 2, req: true, ph: '症状 + 持续时间，如：右侧肢体活动不利伴言语欠清 46 天。' }) +
        field('现病史', 'record.present', r.present, { type: 'textarea', rows: 5, req: true, ph: '起病时间与形式、主要症状演变、诊疗经过、目前功能状态、饮食二便。' }) +
        presentCandPanel(p) +
        casePanel(p) +
        field('既往史', 'record.past', r.past, { type: 'textarea', rows: 3 }) +
        field('个人史', 'record.personal', r.personal, { type: 'textarea', rows: 2 }) +
        field('家族史', 'record.family', r.family, { type: 'textarea', rows: 2 }) +
        field('过敏史', 'record.allergy', r.allergy, { type: 'textarea', rows: 2 }) +
      '</div>', secStatus(p, 'chief')) +

    secBlock('ros', 'ROS', '系统回顾', renderROS(r), null) +

    secBlock('exam', '03', '体格检查',
      '<div class="vitals">' + vitals + '</div>' +
      '<div style="margin-top:10px">' + renderPECommon(r) + '</div>' +
      '<div style="margin-top:10px">' + renderPESpecial(r) + '</div>' +
      '<div class="form-grid two" style="margin-top:10px">' +
        EXAM_SECTIONS.map((s) => field(s.label, 'record.examParts.' + s.key, (r.examParts || {})[s.key], { type: 'textarea', rows: 2 })).join('') +
      '</div>' +
      '<div class="form-grid one" style="margin-top:10px">' +
        field('专科查体（神经系统 / 肌力 / 肌张力 / 感觉）', 'record.neuro', r.neuro, { type: 'textarea', rows: 4 }) +
      '</div>' +
      (neuroScaleLeak(p) ? '<div class="inline-tip warn"><span>专科查体里混有量表评分（如 Barthel / Berg 分数），体格检查段不写量表分。</span><button class="btn tiny outline" data-action="clean-neuro-scale">移除这段评分</button></div>' : '') +
      '<div class="form-grid two" style="margin-top:10px">' +
        AUX_BOXES.map((b) => field(b.label, 'record.auxBoxes.' + b.key, (r.auxBoxes || {})[b.key], { type: 'textarea', rows: 2, ph: AUX_PH[b.key] })).join('') +
      '</div>', secStatus(p, 'exam')) +

    secBlock('tcm', '04', '中医四诊',
      '<div class="form-grid three">' +
        field('舌质', 'record.tcm.tongueBody', tcm.tongueBody, { ph: '淡红 / 红 / 紫暗 / 边有齿痕…' }) +
        field('舌苔', 'record.tcm.tongueCoating', tcm.tongueCoating, { ph: '薄白 / 黄腻 / 白腻 / 少苔…' }) +
        field('脉象', 'record.tcm.pulse', tcm.pulse, { ph: '弦 / 滑 / 细 / 数 / 沉…' }) +
      '</div>' +
      '<div class="form-grid" style="margin-top:8px">' +
        field('神色形态（望）', 'record.tcm.look', tcm.look, { wide: true, ph: '神、色、形、态' }) +
        field('声息气味（闻）', 'record.tcm.hearing', tcm.hearing, { wide: true, ph: '语声、呼吸、体气' }) +
      '</div>' +
      '<div class="form-grid one" style="margin-top:8px">' +
        field('问诊（寒热 / 汗出 / 饮食 / 二便 / 睡眠）', 'record.tcm.ask', tcm.ask, { type: 'textarea', rows: 2 }) +
        field('辨证分型', 'record.tcm.pattern', tcm.pattern, { wide: true, ph: '如 气虚血瘀证 / 肝肾亏虚证' }) +
      '</div>', null) +

    secBlock('diag', '05', '初步诊断',
      '<div class="pill-row">' + r.diagnoses.map((d, i) => '<span class="tag-pill editable">' + esc(d) + '<button data-action="remove-diag" data-i="' + i + '" title="删除">×</button></span>').join('') +
      '<button class="add-inline" data-action="add-diag">+ 添加诊断</button></div>', secStatus(p, 'diag')) +

    secBlock('ddx', '06', '鉴别诊断',
      '<div class="ddx-paste">' +
        '<div style="display:flex;gap:8px;align-items:center;margin-bottom:6px">' +
        '<select id="ddxDiseaseSelect" style="border:1px solid var(--line);border-radius:6px;padding:4px 8px;font-size:11.5px;background:#fff;outline:none">' +
          '<option value="__auto__">自动识别病种</option>' +
          DISEASE_KEYWORDS.map((d) => '<option value="' + d.key + '"' + (p.record.diffDx.key === d.key ? ' selected' : '') + '>' + esc(d.name) + '</option>').join('') +
        '</select>' +
        '<button class="voice-btn ddx-voice" data-action="voice-ddx" title="语音口述病例">🎤 语音口述</button>' +
        '</div>' +
        '<textarea id="ddxInput" rows="2" placeholder="粘贴一段患者病例文本，或直接选病种下拉，一键生成 6 条鉴别要点">' + esc(state.ddxDraft) + '</textarea>' +
        '<div class="ddx-actions"><button class="btn small solid" data-action="gen-ddx">⚡ 一键生成鉴别诊断</button>' +
        '<span class="hint" id="ddxHint">' + (r.diffDx.items.length ? '已生成 ' + r.diffDx.items.length + ' 条 · ' + esc((DISEASE_KEYWORDS.find((x) => x.key === r.diffDx.key) || {}).name || '') : '粘贴病例 / 选病种下拉，一键生成') + '</span></div>' +
      '</div>' +
      '<div class="ddx-list">' + (r.diffDx.items.length ? r.diffDx.items.map((it, i) =>
        '<div class="ddx-item"><span class="ddx-no">' + (i + 1) + '</span>' +
        '<div class="ddx-body">' +
          '<input class="ddx-d" data-ddx-d="' + i + '" value="' + esc(it.d) + '" placeholder="鉴别诊断名称">' +
          '<input class="ddx-s" data-ddx-s="' + i + '" value="' + esc(it.support || '') + '" placeholder="支持点：支持本病或需鉴别的要点">' +
          '<input class="ddx-a" data-ddx-a="' + i + '" value="' + esc(it.against || '') + '" placeholder="不支持点：阴性表现或不相符之处（可留空）">' +
          '<input class="ddx-c" data-ddx-c="' + i + '" value="' + esc(it.advice || '') + '" placeholder="建议检查：进一步鉴别手段（可留空）">' +
        '</div>' +
        '<button class="rm" data-action="remove-ddx" data-i="' + i + '" title="删除">×</button></div>').join('')
        : '<div class="blank" style="padding:14px">粘贴病例文本生成鉴别要点，或点下方按钮直接按病种生成。</div>') +
      '</div>' +
      '<div style="margin-top:8px;display:flex;gap:8px;align-items:center"><button class="add-inline" data-action="add-ddx">+ 添加鉴别条目</button>' +
      '<span style="font-size:10.5px;color:var(--faint)">条目可逐条修改，将写入打印稿</span></div>', secStatus(p, 'ddx')) +

    secBlock('goal', '07', '康复问题与目标',
      '<div style="display:flex;gap:8px;margin-bottom:12px;flex-wrap:wrap">' +
      '<button class="btn small solid" data-action="fill-template">⚡ 按病种模板补全所有空字段</button>' +
      '<span style="font-size:10.5px;color:var(--faint);align-self:center">已识别病种：' + esc((DISEASE_KEYWORDS.find((x) => x.key === (p.diseaseKey || 'geriatric')) || {}).name || '老年慢病') + ' · 只填空的，已填的不覆盖</span>' +
      '</div>' +
      '<div class="pill-row" style="margin-bottom:10px">' + r.problems.map((d, i) => '<span class="tag-pill editable">' + esc(d) + '<button data-action="remove-problem" data-i="' + i + '" title="删除">×</button></span>').join('') +
      '<button class="add-inline" data-action="add-problem">+ 添加问题</button>' +
      '<button class="add-inline" data-action="gen-problems">由评估自动生成</button></div>' +
      '<div class="form-grid one">' +
        field('短期目标（2 周）', 'record.goalsShort', r.goalsShort, { type: 'textarea', rows: 2, ph: '可量化、可评定，如 Barthel 提高 10 分。' }) +
        field('长期目标（4 周 / 出院）', 'record.goalsLong', r.goalsLong, { type: 'textarea', rows: 2 }) +
        field('康复治疗方案', 'record.plan', r.plan, { type: 'textarea', rows: 3, ph: 'PT / OT / ST / 理疗 / 中医治疗的项目、频次与时长。' }) +
        planPhrasePanel(r.plan) +
        planItemsPanel(r.planItems) +
      '</div>' +
      '<div style="display:flex;gap:8px;margin-top:10px;align-items:center"><button class="btn small solid" data-action="gen-goals">按评估生成问题与目标</button>' +
      '<span style="font-size:10.5px;color:var(--faint)">量表得分自动写入打印稿「康复评定」段，不混入专科查体</span></div>', secStatus(p, 'goal')) +

    '<div class="sheet-foot"><span>本记录由康复病历工作台生成 · ' + nowHM() + '</span>' +
      '<div class="sign"><div class="sign-line"></div><span>记录医师：' + esc(doctorLabel()) + '　' + todayISO() + '</span>' +
      (state.supervisor ? '<div class="sign-line"></div><span>审核医师：' + esc(state.supervisor) + '</span>' : '') + '</div></div>' +
  '</div>';
}

/* ---------------- 康复评估 ---------------- */
function metric(label, value, unit, gradeLabel, level, delta) {
  const d = delta == null || delta === 0 ? '' : '<span class="' + (delta > 0 ? 'delta-up' : 'delta-down') + '">' + (delta > 0 ? '▲' : '▼') + Math.abs(delta) + '</span>';
  return '<div class="metric ' + (level === 'bad' ? 'g-bad' : level === 'warn' ? 'g-warn' : '') + '">' +
    '<div class="m-label"><span>' + label + '</span>' + d + '</div>' +
    '<div class="m-value">' + value + '<small>' + unit + '</small></div>' +
    '<div class="m-foot"><span>' + gradeLabel + '</span></div></div>';
}

function scaleCard(title, sub, scoreHtml, grade, body, note, foot, cardId) {
  const g = grade || { label: '', level: 'ok' };
  const id = cardId || title;
  const collapsed = !!state.collapsedScale[id];
  // title/sub/note/分级标签可来自量表管理表单或导入备份，属用户可控文本，必须转义；
  // scoreHtml/body/foot 为调用方构造的结构化 HTML，保持原样
  const idAttr = esc(id);
  return '<div class="scale' + (collapsed ? ' collapsed' : '') + '" data-scale="' + idAttr + '">' +
    '<div class="scale-head" data-scale-toggle="' + idAttr + '"><div class="scale-title"><h4>' + esc(title) + '</h4><p>' + esc(sub) + '</p></div>' +
    '<div class="score-box">' + scoreHtml + '</div><span class="score-grade lv-' + esc(g.level) + '">' + esc(g.label) + '</span>' +
    '<span class="sec-arrow">' + (collapsed ? '▸' : '▾') + '</span></div>' +
    '<div class="scale-body-wrap"><div class="scale-body">' + body + (note ? '<div class="scale-note">' + esc(note) + '</div>' : '') + '</div>' +
    (foot ? '<div class="scale-foot">' + foot + '</div>' : '') + '</div></div>';
}

/* ===== 评估速查知识库：只读卡片渲染 ===== */
const ASSESS_FILTERS = [['all', '全部'], ['neuro', '神经康复'], ['ortho', '骨肌康复'], ['scale', '评定量表']];

function knowledgeMatch(g, q) {
  const parts = [g.title, g.en, g.body || ''];
  (g.headers || []).forEach((h) => parts.push(h));
  (g.rows || []).forEach((r) => r.forEach((c) => parts.push(c)));
  (g.notes || []).forEach((n) => parts.push(n));
  return parts.join(' ').toLowerCase().indexOf(q) >= 0;
}

function knBodyHtml(g) {
  let body = '';
  if (g.body) body += '<div class="kn-text">' + esc(g.body) + '</div>';
  if (g.headers && g.rows) {
    body += '<table class="kv-table"><thead><tr>' + g.headers.map((h) => '<th>' + esc(h) + '</th>').join('') + '</tr></thead><tbody>' +
      g.rows.map((r) => '<tr>' + r.map((c) => '<td>' + esc(c) + '</td>').join('') + '</tr>').join('') + '</tbody></table>';
  }
  if (g.notes && g.notes.length) body += g.notes.map((n) => '<div class="kn-note">' + esc(n) + '</div>').join('');
  return body;
}

function knCard(g) {
  const collapsed = !!state.collapsedScale[g.id];
  return '<div class="scale kn-card' + (collapsed ? ' collapsed' : '') + '" data-scale="' + g.id + '">' +
    '<div class="scale-head" data-scale-toggle="' + g.id + '"><div class="scale-title"><h4>' + esc(g.title) + '</h4><p>' + esc(g.en) + '</p></div>' +
    '<span class="sec-arrow">' + (collapsed ? '▸' : '▾') + '</span></div>' +
    '<div class="scale-body-wrap"><div class="scale-body">' + knBodyHtml(g) + '</div></div></div>';
}

function knowledgeHtml() {
  const q = state.assessQuery.trim().toLowerCase();
  const groups = KNOWLEDGE_GROUPS.filter((g) =>
    (state.assessFilter === 'all' || state.assessFilter === g.cat) &&
    (!q || knowledgeMatch(g, q))
  );
  if (!groups.length) return '<div class="blank">未找到匹配的速查内容</div>';
  // 按部位 part 聚合（无 part 归入匿名组），组间保持首次出现顺序，避免依赖数据排列
  const order = [], map = {};
  groups.forEach((g) => {
    const key = g.part || '__none__';
    if (!map[key]) { map[key] = []; order.push(key); }
    map[key].push(g);
  });
  let html = '';
  order.forEach((key) => {
    const bag = map[key];
    if (key !== '__none__') html += '<div class="kn-part">' + esc(bag[0].part) + '</div>';
    bag.forEach((g) => { html += knCard(g); });
  });
  return html;
}

/* ===== 量表区：先选后录 =====
   原来的做法是把当前页签下所有量表卡整列铺开，量多时要翻很久才能找到要录的那张。
   改成：一行量表名（带当前分数）当选择条，点哪个才展开哪张卡，可多选、可收起。 */
const SCALE_SHORT = {
  '徒手肌力评定 MMT': '肌力 MMT',
  '改良 Ashworth 肌张力': '肌张力 MAS',
  'Brunnstrom 运动恢复分期': 'Brunnstrom',
  'Barthel 指数（ADL）': 'Barthel',
  'Berg 平衡量表': 'Berg 平衡',
  'Holden 步行功能分级': 'Holden 步行',
  'MMSE 简易精神状态检查': 'MMSE 认知',
  '洼田饮水试验': '洼田饮水',
  'VAS 疼痛评分': 'VAS 疼痛',
  '量表目录': '量表目录'
};
function shortScaleName(t) {
  const key = asStr(t);
  if (SCALE_SHORT[key]) return SCALE_SHORT[key];
  return key.length > 14 ? key.slice(0, 14) + '…' : key;
}
/* 选中集合按评估页签各自独立，避免运动功能的勾选把活动量表也带出来 */
function scalePickOf(tab) {
  if (!isObj(state.scalePick)) state.scalePick = {};
  if (!isObj(state.scalePick[tab])) state.scalePick[tab] = {};
  return state.scalePick[tab];
}
function scalePickerHtml(list, tab) {
  const pk = scalePickOf(tab);
  const chosen = list.filter((x) => pk[x.t]);
  if (!isObj(state.pkMore)) state.pkMore = {};
  // 内置与"已加入"的量表一律常驻显示：点了「加入」就必须在这里找到它，否则等于没加
  const shown = list;
  const hiddenN = 0;
  let h = '<div class="pk-bar"><span class="pk-tip">评定量表 <b>' + list.length + '</b> 项 · 点选要录入的</span>' +
    (chosen.length ? '<button class="pk-clear" data-spick-clear="' + esc(tab) + '">收起已选 ' + chosen.length + ' 项</button>' : '') + '</div>' +
    '<div class="pk-chips">' +
    shown.map((x) => '<button class="pk-chip' + (pk[x.t] ? ' on' : '') + '" data-spick="' + esc(x.t) + '" data-spick-tab="' + esc(tab) + '" title="' + esc(x.t) + '">' +
      esc(shortScaleName(x.t)) + (x.v != null && x.v !== '' ? '<b>' + esc(x.v) + '</b>' : '') + '</button>').join('') +
    (hiddenN ? '<button class="pk-chip pk-more" data-spick-more="' + esc(tab) + '">' + (moreOpen ? '收起' : '+ 更多 ' + hiddenN + ' 项') + '</button>' : '') +
    '</div>';
  if (chosen.length) h += '<div class="pk-cards">' + chosen.map((x) => x.h).join('') + '</div>';
  else h += '<div class="pk-hint">点选上方任一量表即可开始录入，分数自动写入病程与打印；也可只录一项</div>';
  return h;
}

/* 录入量表区：选择条 + 选中的量表卡 + 量表目录，供整体渲染与局部刷新复用 */
function assessScaleHtml(p, a) {
  if (!p || !a) return '';
  const list = state.assessTab === 'motor' ? assessMotor(p, a)
    : state.assessTab === 'func' ? assessFunc(p, a) : assessSpecial(p, a);
  return scalePickerHtml(list, state.assessTab) + renderScaleCatalog(state.assessTab);
}

/* 速查卡是否展开：搜了关键词必须展开（否则搜到也看不见）；
   默认在「全部」收起、只在「神经/骨肌」筛选下展开，避免挡住要录分的量表 */
function knOpenNow() {
  if (state.assessQuery.trim()) return true;
  if (state.knOpen === null || state.knOpen === undefined) {
    return state.assessFilter === 'neuro' || state.assessFilter === 'ortho';
  }
  return !!state.knOpen;
}

/* 速查卡区：常驻一行折叠入口，点开就地展开；收起时只占一行，不挤占量表视野 */
function knFoldHtml() {
  const open = knOpenNow();
  const n = KNOWLEDGE_GROUPS.filter((g) => state.assessFilter === 'all' || state.assessFilter === g.cat).length;
  return '<div class="kn-fold' + (open ? ' open' : '') + '" data-kn-toggle="1" role="button" tabindex="0">' +
    '<span class="kn-fold-main">康复速查知识卡 <b>' + n + '</b> 条</span>' +
    '<i class="kn-fold-sub">分期标准 · 评分方法 · 依据出处</i>' +
    '<span class="sec-arrow">' + (open ? '▾' : '▸') + '</span></div>';
}

/* 评估页主体：折叠入口 → 展开的知识卡（就近显示）→ 录入量表。
   默认收起，量表紧跟在入口下方；用户点开才占用纵向空间 */
function assessBodyHtml(p, a) {
  const showScale = state.assessFilter === 'all' || state.assessFilter === 'scale';
  let h = '';
  // 折叠条与知识卡由 viewAssess 统一放在概况卡下方，这里只放录入区，避免出现两条折叠条
  if (showScale) h += assessScaleHtml(p, a);
  return h;
}

/* 本次评定解读：按已评量表的分档讲清"这意味着什么、有什么风险、下一步做什么"；没评过的量表一律不编造 */
function assessInsight(p, a, prev) {
  if (!a) return '';
  const aff = affectedIndex(p);
  const pts = [];
  const risks = [];
  const nexts = [];
  const dlt = (key, getter) => {
    const d = (prev && isTouched(prev, key)) ? getter(a) - getter(prev) : 0;
    return d ? '<span class="ic-delta">较上次 ' + (d > 0 ? '+' : '') + d + '</span>' : '';
  };

  if (isTouched(a, 'barthel')) {
    const b = barthelTotal(a);
    let t;
    if (b <= 20) t = '进食、修饰、穿衣、如厕、转移、行走、上下楼基本靠他人完成。住院期需 24 小时陪护，床边防坠床、每 2 小时翻身防压疮；训练从床椅转移与坐位平衡起步。';
    else if (b <= 40) t = '多数项目需大量帮助。转移与如厕是首要突破口，先练坐站转移与辅助下如厕，再推进辅助行走。';
    else if (b <= 60) t = '部分项目需帮助，穿衣、洗澡、上下楼是主要难点；训练以部分自理与耐力为主。';
    else if (b < 100) t = '多数项目独立，重点补上下楼、洗澡与室外行走安全。';
    else t = '日常生活完全自理，重点转向平衡、耐力与社区参与。';
    if (b <= 40) risks.push('跌倒与压疮风险高（卧床或转移依赖）');
    pts.push({ k: '日常生活能力 · Barthel ' + b + ' 分（' + barthelGrade(b).label + '）' + dlt('barthel', barthelTotal), t });
  }
  if (isTouched(a, 'berg')) {
    const g = bergTotal(a);
    const t = g >= 41 ? '平衡接近独立，可在监护下练单腿站立、转身与跨越。'
      : g >= 21 ? '需辅助行走，先练坐位到站立、原地迈步的分解动作，行走时一人监护并配助行器。'
      : '以轮椅/卧床为主，先练床上翻身、桥式与坐位平衡，暂不独自站立。';
    if (g < 41) risks.push('跌倒风险增加（Berg ' + g + ' 分，低于 41 分阈值）');
    pts.push({ k: '平衡功能 · Berg ' + g + ' 分（' + bergGrade(g).label + '）' + dlt('berg', bergTotal), t });
  }
  if (isTouched(a, 'holden')) {
    const h = Number(a.holden);
    const t = h >= 4 ? '平地可独立行走，上下楼与室外不平地面仍需帮助；可加长距离、转向与跨步训练。'
      : h >= 2 ? '行走需间断或持续帮助，以助行器加一人监护为主，先解决步态对称性与耐力。'
      : '尚不能步行，先练站立平衡与重心转移，再进平行杠内步行。';
    pts.push({ k: '步行能力 · Holden ' + h + ' 级' + dlt('holden', (x) => Number(x.holden)), t });
  }
  if (isTouched(a, 'mmt')) {
    const knee = mmtOf(a, '膝伸展', aff);
    const t = knee >= 4 ? '患侧膝伸肌力接近正常，可负重站立与上下台阶。'
      : knee >= 3 ? '可抗重力完成全范围，能扶站但耐久差；重点练股四头肌耐力与离心控制。'
      : '不能抗重力，暂不宜独立负重站立；先练床上伸膝、桥式与神经肌肉电刺激。';
    if (knee < 3) risks.push('站立负重能力不足，转移需两人协助');
    pts.push({ k: '患侧膝伸肌力 · MMT ' + knee + ' 级' + dlt('mmt', (x) => mmtOf(x, '膝伸展', aff)), t });
  }
  if (isTouched(a, 'mas')) {
    const m = masMax(a);
    const t = m >= 2 ? '痉挛明显，影响被动活动与步态；需良肢位摆放、缓慢牵伸与物理因子治疗，避免快速牵拉诱发痉挛加重。'
      : m > 0 ? '肌张力轻度增高，注意良肢位摆放与定时牵伸。'
      : '肌张力无明显增高。';
    pts.push({ k: '肌张力 · MAS ' + (m === 1.5 ? '1+' : m) + ' 级' + dlt('mas', masMax), t });
  }
  if (isTouched(a, 'kouda')) {
    const kd = Number(a.kouda);
    const t = kd >= 3 ? '吞咽功能异常，存在误吸风险：食物改糊状或增稠，进食坐位 90°、餐后保持坐位 30 分钟，必要时留置胃管评估。'
      : kd === 2 ? '饮水试验可疑，进食需小口慢咽并观察呛咳。'
      : '吞咽筛查未见异常。';
    if (kd >= 3) risks.push('误吸/吸入性肺炎风险（洼田 ' + kd + ' 级）');
    if (kd >= 3) nexts.push('吞咽功能进一步评估或 ST 介入');
    pts.push({ k: '吞咽 · 洼田饮水 ' + kd + ' 级' + dlt('kouda', (x) => Number(x.kouda)), t });
  }
  if (isTouched(a, 'mmse')) {
    const ms = mmseTotal(a);
    const t = ms >= 27 ? '认知筛查正常，可配合多步骤指令训练。'
      : ms >= 21 ? '轻度认知障碍：指令需简短、分步、重复，训练配合度可能受影响。'
      : '中重度认知障碍：需家属陪同与简化指令，注意走失与误服风险。';
    if (ms < 24) { risks.push('认知障碍影响训练配合与居家安全'); nexts.push('认知训练与家属看护教育'); }
    pts.push({ k: '认知 · MMSE ' + ms + ' 分（' + mmseGrade(ms).label + '）' + dlt('mmse', mmseTotal), t });
  }
  if (isTouched(a, 'vas')) {
    const v = Number(a.vas);
    const t = v >= 7 ? '重度疼痛，先控制疼痛再推进负重与步行训练，避免疼痛抑制影响出力。'
      : v >= 4 ? '中度疼痛，训练前后评估疼痛变化，必要时理疗镇痛。'
      : '疼痛轻微，可按计划推进训练。';
    if (v >= 7) risks.push('疼痛限制训练强度');
    pts.push({ k: '疼痛 · VAS ' + v + ' 分' + dlt('vas', (x) => Number(x.vas)), t });
  }
  state.customScales.filter((d) => d.inSummary && hasCustomValue(a, d)).forEach((d) => {
    const v = scaleTotal(a, d), g = scaleGrade(d, v);
    pts.push({ k: d.title + ' · ' + v + (d.max ? '/' + d.max : ' 分') + (g.label ? '（' + g.label + '）' : ''), t: (d.note || '按量表分档解读，结合临床判断。') });
  });

  if (!pts.length) return '';
  if (!isTouched(a, 'berg')) nexts.push('补评 Berg 平衡量表（跌倒风险筛查）');
  if (!isTouched(a, 'kouda') && /脑|卒|瘫|颅/.test(p.diagShort || '')) nexts.push('补评洼田饮水试验（吞咽筛查）');
  if (!isTouched(a, 'mmse') && Number(p.age) >= 60) nexts.push('补评 MMSE（老年认知筛查）');

  const level = risks.length >= 2 ? 'bad' : risks.length ? 'warn' : 'ok';
  return '<div class="insight-card lv-' + level + '">' +
    '<div class="ic-head"><span class="ic-t">本次评定解读</span><span class="ic-d">' + esc(a.date) + (prev ? '　对比 ' + esc(prev.date) : '　首次评定') + '</span>' +
    (risks.length ? '<span class="ic-risk-tag">' + risks.length + ' 项风险提示</span>' : '') + '</div>' +
    '<ul class="ic-list">' + pts.map((x) => '<li><b>' + x.k + '</b><span>' + x.t + '</span></li>').join('') + '</ul>' +
    (risks.length ? '<div class="ic-row ic-risk"><b>风险提示</b><span>' + risks.join('；') + '。</span></div>' : '') +
    (nexts.length ? '<div class="ic-row ic-next"><b>下一步建议</b><span>' + nexts.join('；') + '。</span></div>' : '') +
    '<div class="ic-foot">解读按量表分档自动生成，需结合临床表现与合并症判断，不替代医师判断。</div>' +
  '</div>';
}

function viewAssess(p) {
  const list = p.assessments;
  const a = latest(p);
  const showScale = state.assessFilter === 'all' || state.assessFilter === 'scale';
  const showKnow = state.assessFilter !== 'scale';
  const banner = '<div class="kn-banner"><div class="kn-banner-t">临床康复评估速查</div>' +
    '<div class="kn-banner-s">分类筛选 · 关键词检索 · 量表评定与循证对照（仅供专业人员参考，不替代面诊与诊断）</div>' +
    '<div class="kn-pills">' + ASSESS_FILTERS.map(([k2, l]) => '<button class="kn-pill' + (state.assessFilter === k2 ? ' active' : '') + '" data-afilter="' + k2 + '">' + l + '</button>').join('') + '</div>' +
    (showKnow ? '<div class="kn-search"><span class="kn-search-ico">🔍</span><input type="text" id="assessSearch" placeholder="搜索评估测试、肌群、技术、检查…" value="' + esc(state.assessQuery) + '"></div>' : '') + '</div>';
  if (!a) {
    // 首评入口必须顶在最上面：原来把它压在 8 条知识卡之后，医生进来只看到知识卡，以为评估不了
    // 速查卡整体收到"开始首次评估"下面，不占首屏
    return '<div class="stack">' +
      '<div class="assess-empty"><div class="ae-t">该患者还没有康复评估记录</div>' +
      '<div class="ae-s">点下面的按钮开始第一次评定，录完的分数会自动写进病程记录与打印稿</div>' +
      '<button class="btn solid" data-action="new-assessment">开始首次评估</button></div>' +
      (showKnow
        ? knFoldHtml() + (knOpenNow() ? banner + '<div class="kn-list">' + knowledgeHtml() + '</div>' : '')
        : banner) +
      '</div>';
  }
  const prev = previous(p);
  const b = barthelTotal(a), bg = bergTotal(a), ms = mmseTotal(a);
  const aff = affectedIndex(p);
  const knee = mmtOf(a, '膝伸展', aff);
  const k = koudaInfo(a.kouda);
  const delta = (getter) => prev ? getter(a) - getter(prev) : null;
  const customMetricHtml = state.customScales.filter((d) => d.inSummary && hasCustomValue(a, d)).map((d) => {
    const v = scaleTotal(a, d), g = scaleGrade(d, v);
    return metric(d.title, v, d.max ? '/' + d.max : '', g.label, g.level, delta((x) => scaleTotal(x, d)));
  }).join('');
  /* 没录过的量表显示"未评定"，不把默认 0 分冒充成评定结果 */
  const na = (label) => metric(label, '—', '', '未评定', '', null);
  const sum = '<div class="assess-top">' +
    (isTouched(a, 'barthel') ? metric('Barthel 指数', b, '/100', barthelGrade(b).label, barthelGrade(b).level, delta(barthelTotal)) : na('Barthel 指数')) +
    (isTouched(a, 'berg') ? metric('Berg 平衡', bg, '/56', bergGrade(bg).label, bergGrade(bg).level, delta(bergTotal)) : na('Berg 平衡')) +
    (isTouched(a, 'mmt') ? metric('患侧膝伸肌力', knee, '级', knee >= 4 ? '接近正常' : knee >= 3 ? '抗重力' : '肌力不足', knee >= 4 ? 'ok' : knee >= 3 ? 'warn' : 'bad', delta((x) => mmtOf(x, '膝伸展', aff))) : na('患侧膝伸肌力')) +
    (isTouched(a, 'mas') ? metric('改良 Ashworth', masMax(a) === 1.5 ? '1+' : masMax(a), '级', masMax(a) >= 2 ? '痉挛明显' : masMax(a) > 0 ? '轻度增高' : '无增高', masMax(a) >= 2 ? 'bad' : masMax(a) > 0 ? 'warn' : 'ok', delta(masMax)) : na('改良 Ashworth')) +
    (isTouched(a, 'vas') ? metric('VAS 疼痛', a.vas, '/10', Number(a.vas) >= 4 ? '需干预' : '轻度', Number(a.vas) >= 7 ? 'bad' : Number(a.vas) >= 4 ? 'warn' : 'ok', delta((x) => Number(x.vas))) : na('VAS 疼痛')) +
    (isTouched(a, 'kouda') ? metric('洼田饮水', a.kouda, '级', k.label.split(' · ')[0], k.level, delta((x) => Number(x.kouda))) : na('洼田饮水')) +
    customMetricHtml +
  '</div>';

  const bar = '<div class="assess-bar"><div class="ab-date">评定日期 <input type="date" data-assess-date value="' + esc(a.date) + '"></div>' +
    '<span class="badge-src">共 ' + list.length + ' 次评定</span><div class="spacer"></div>' +
    (showScale ? '<div class="subtabs">' +
      ['motor|运动功能', 'func|活动与平衡', 'special|专项评估'].map((x) => { const [k2, l] = x.split('|'); return '<button class="subtab' + (state.assessTab === k2 ? ' active' : '') + '" data-subtab="' + k2 + '">' + l + '</button>'; }).join('') +
    '</div>' : '') + '<button class="btn small outline" data-action="scale-manager">量表管理</button><button class="btn small outline" data-action="new-assessment">新增评定</button></div>';

  let body = '<div id="assessBody">' + assessBodyHtml(p, a) + '</div>';

  // 速查横幅也收进折叠条：展开才出现，不常驻占屏
  return '<div class="stack">' + sum + assessInsight(p, a, prev) +
    (showKnow ? knFoldHtml() + (knOpenNow() ? banner + '<div class="kn-list">' + knowledgeHtml() + '</div>' : '') : banner) +
    bar + body + trendCard(p) + '</div>';
}

function assessMotor(p, a) {
  const aff = affectedIndex(p);
  const mmtRows = MMT_GROUPS.map((g) => {
    const row = a.mmt[g] || [0, 0];
    const opts = (idx) => MMT_LEVELS.map((l) => '<option value="' + l.v + '"' + (Number(row[idx]) === l.v ? ' selected' : '') + '>' + l.v + ' 级</option>').join('');
    return '<div class="mg-cell name">' + g + '</div><div class="mg-cell"><select data-assess="mmt.' + g + '.0" aria-label="' + g + ' 左">' + opts(0) + '</select></div>' +
      '<div class="mg-cell"><select data-assess="mmt.' + g + '.1" aria-label="' + g + ' 右">' + opts(1) + '</select></div>';
  }).join('');
  const mmt = scaleCard('徒手肌力评定 MMT', 'MRC 0–5 级 · 左 / 右分别记录',
    isTouched(a, 'mmt') ? '<span class="val">' + mmtOf(a, '膝伸展', aff) + '</span><span class="max">患侧膝伸</span>' : '<span class="val">—</span><span class="max">未评定</span>',
    isTouched(a, 'mmt') ? (mmtOf(a, '膝伸展', aff) >= 4 ? { label: '肌力良好', level: 'ok' } : null) : { label: '未评定', level: '' },
    '<div class="mmt-grid"><div class="mg-head">肌群</div><div class="mg-head side-l">左侧</div><div class="mg-head side-r">右侧</div>' + mmtRows + '</div>',
    '肌力 3 级为抗重力完成全范围活动，2 级为消除重力可活动，是判断能否负重站立的关键分界。',
    '<span class="hint">患侧：' + (p.side || '未标注') + '　红色为左 / 绿色为右</span>');

  const masRows = MAS_GROUPS.map((g) => {
    const row = a.mas[g] || ['0', '0'];
    const opts = (idx) => MAS_LEVELS.map((l) => '<option value="' + l.v + '"' + (String(row[idx]) === l.v ? ' selected' : '') + '>' + l.v + ' 级</option>').join('');
    return '<div class="mg-cell name">' + g + '</div><div class="mg-cell"><select data-assess="mas.' + g + '.0">' + opts(0) + '</select></div><div class="mg-cell"><select data-assess="mas.' + g + '.1">' + opts(1) + '</select></div>';
  }).join('');
  const mas = scaleCard('改良 Ashworth 肌张力', 'MAS · 0 / 1 / 1+ / 2 / 3 / 4 级',
    isTouched(a, 'mas') ? '<span class="val">' + (masMax(a) === 1.5 ? '1+' : masMax(a)) + '</span><span class="max">最高级</span>' : '<span class="val">—</span><span class="max">未评定</span>',
    isTouched(a, 'mas') ? (masMax(a) >= 2 ? { label: '痉挛明显', level: 'bad' } : masMax(a) > 0 ? { label: '轻度增高', level: 'warn' } : { label: '无增高', level: 'ok' }) : { label: '未评定', level: '' },
    '<div class="mmt-grid"><div class="mg-head">肌群</div><div class="mg-head side-l">左侧</div><div class="mg-head side-r">右侧</div>' + masRows + '</div>',
    'MAS ≥ 2 级提示痉挛影响被动活动，需结合抗痉挛体位、牵伸及物理因子治疗。');

  const bs = a.brunnstrom;
  const bsCard = scaleCard('Brunnstrom 运动恢复分期', '偏瘫肢体运动功能恢复六阶段',
    isTouched(a, 'brunnstrom') ? '<span class="val">' + esc(bs.upper || '—') + '</span><span class="max">上肢</span>' : '<span class="val">—</span><span class="max">未评定</span>',
    isTouched(a, 'brunnstrom') ? { label: '恢复期', level: 'warn' } : { label: '未评定', level: '' },
    '<div class="select-row">' +
      [['upper', '上肢'], ['hand', '手'], ['lower', '下肢']].map(([k, l]) => '<div class="sel-field"><label>' + l + '</label><select data-assess="brunnstrom.' + k + '">' +
        BRUNNSTROM_STAGES.map((s) => '<option value="' + s.v + '"' + (bs[k] === s.v ? ' selected' : '') + '>' + s.label + '</option>').join('') + '</select></div>').join('') +
    '</div>',
    'Ⅲ 期以共同运动为主，Ⅳ 期后出现分离运动，是制定作业治疗与手功能训练目标的依据。');

  return [
    { t: '徒手肌力评定 MMT', h: mmt, v: isTouched(a, 'mmt') ? mmtOf(a, '膝伸展', aff) + ' 级' : '—' },
    { t: '改良 Ashworth 肌张力', h: mas, v: isTouched(a, 'mas') ? (masMax(a) === 1.5 ? '1+' : masMax(a)) + ' 级' : '—' },
    { t: 'Brunnstrom 运动恢复分期', h: bsCard, v: isTouched(a, 'brunnstrom') ? (bs.upper || '—') : '—' }
  ].concat(customCards(p, a, 'motor'));
}

function assessFunc(p, a) {
  const rows = BARTHEL_ITEMS.map((it) => {
    const cur = Number(a.barthel[it.key] || 0);
    return '<div class="brow"><span class="bl">' + it.label + '</span><select data-assess="barthel.' + it.key + '">' +
      it.levels.map(([v, l]) => '<option value="' + v + '"' + (cur === v ? ' selected' : '') + '>' + l + '</option>').join('') + '</select></div>';
  }).join('');
  const b = barthelTotal(a), bg = bergTotal(a);
  /* 卡片里没评过也写"—"，避免打开卡片看到"0/100"以为已经评过 */
  const bTxt = isTouched(a, 'barthel') ? '<span class="val">' + b + '</span><span class="max">/100</span>' : '<span class="val">—</span><span class="max">未评定</span>';
  const bGrade = isTouched(a, 'barthel') ? barthelGrade(b) : { label: '未评定', level: '' };
  const barthel = scaleCard('Barthel 指数（ADL）', '10 项日常生活活动能力 · 总分 100 分', bTxt, bGrade,
    '<div class="barthel-grid">' + rows + '</div>',
    '分级：100 分独立；61–99 轻度依赖；41–60 中度依赖；21–40 重度依赖；≤20 完全依赖。',
    '<span class="hint">评分基于患者实际完成情况，不按"能否"估计</span>');

  const bergRows = BERG_ITEMS.map((name, i) => {
    const v = Number(a.berg[i] || 0);
    return '<div class="bgrow"><span class="n">' + String(i + 1).padStart(2, '0') + '</span><span class="t">' + name + '</span>' +
      '<span class="lvl-group">' + [0, 1, 2, 3, 4].map((n) => '<button data-berg="' + i + '" data-val="' + n + '" class="' + (v === n ? 'on' : '') + '" title="' + n + ' 分">' + n + '</button>').join('') + '</span></div>';
  }).join('');
  const bTxt2 = isTouched(a, 'berg') ? '<span class="val">' + bg + '</span><span class="max">/56</span>' : '<span class="val">—</span><span class="max">未评定</span>';
  const berg = scaleCard('Berg 平衡量表', '14 项 · 每项 0–4 分 · 总分 56 分', bTxt2, isTouched(a, 'berg') ? bergGrade(bg) : { label: '未评定', level: '' },
    '<div class="berg-grid">' + bergRows + '</div>',
    '41–56 分独立行走；21–40 分辅助行走；0–20 分轮椅/卧床。<45 分提示跌倒风险增加，需加强监护。',
    '<span class="hint">评分取最能代表患者当前表现的一档</span>');

  const holden = scaleCard('Holden 步行功能分级', '0–5 级 · 步行独立程度',
    isTouched(a, 'holden') ? '<span class="val">' + a.holden + '</span><span class="max">级</span>' : '<span class="val">—</span><span class="max">未评定</span>',
    isTouched(a, 'holden') ? { label: a.holden >= 4 ? '接近独立' : a.holden >= 2 ? '需辅助' : '不能步行', level: a.holden >= 4 ? 'ok' : a.holden >= 2 ? 'warn' : 'bad' } : { label: '未评定', level: '' },
    '<div class="select-row" style="grid-template-columns:1fr"><div class="sel-field"><label>当前步行能力</label><select data-assess="holden">' +
      HOLDEN_LEVELS.map((l) => '<option value="' + l.v + '"' + (Number(a.holden) === l.v ? ' selected' : '') + '>' + l.label + '</option>').join('') + '</select></div></div>',
    '步行分级用于确定辅助器具、监护强度与出院步行目标。');

  return [
    { t: 'Barthel 指数（ADL）', h: barthel, v: isTouched(a, 'barthel') ? b + ' 分' : '—' },
    { t: 'Berg 平衡量表', h: berg, v: isTouched(a, 'berg') ? bg + ' 分' : '—' },
    { t: 'Holden 步行功能分级', h: holden, v: isTouched(a, 'holden') ? a.holden + ' 级' : '—' }
  ].concat(customCards(p, a, 'func'));
}

function assessSpecial(p, a) {
  const ms = mmseTotal(a), k = koudaInfo(a.kouda);
  const mmseRows = MMSE_ITEMS.map((it) => {
    const v = Number((a.mmse || {})[it.key] || 0);
    return '<div class="mrow"><span class="ml">' + it.label + '</span><span class="mr"><input data-assess="mmse.' + it.key + '" type="number" min="0" max="' + it.max + '" value="' + v + '"><span class="mx">/ ' + it.max + '</span></span></div>';
  }).join('');
  const mmse = scaleCard('MMSE 简易精神状态检查', '总分 30 分 · 需结合受教育程度判读',
    isTouched(a, 'mmse') ? '<span class="val">' + ms + '</span><span class="max">/30</span>' : '<span class="val">—</span><span class="max">未评定</span>',
    isTouched(a, 'mmse') ? mmseGrade(ms) : { label: '未评定', level: '' },
    '<div class="mmse-grid">' + mmseRows + '</div>',
    '27–30 分认知正常；21–26 分轻度认知障碍；10–20 分中度；<10 分重度。文盲、低教育程度者 cutoff 需下调。');

  const kouda = scaleCard('洼田饮水试验', '30 ml 温水 · 吞咽功能筛查',
    isTouched(a, 'kouda') ? '<span class="val">' + a.kouda + '</span><span class="max">级</span>' : '<span class="val">—</span><span class="max">未评定</span>',
    isTouched(a, 'kouda') ? { label: k.label.split(' · ')[0], level: k.level } : { label: '未评定', level: '' },
    '<div class="select-row" style="grid-template-columns:1fr"><div class="sel-field"><label>试验结果</label><select data-assess="kouda">' +
      KOUDA_LEVELS.map((l) => '<option value="' + l.v + '"' + (Number(a.kouda) === l.v ? ' selected' : '') + '>' + l.label + '</option>').join('') + '</select></div></div>',
    '3 级及以上提示吞咽功能异常，需进一步行饮水试验复评或吞咽造影，并调整食物性状。选择"5 级"时建议同步评估留置胃管必要性。');

  const vas = scaleCard('VAS 疼痛评分', '0 = 无痛，10 = 剧痛',
    isTouched(a, 'vas') ? '<span class="val">' + a.vas + '</span><span class="max">/10</span>' : '<span class="val">—</span><span class="max">未评定</span>',
    isTouched(a, 'vas') ? { label: Number(a.vas) >= 7 ? '重度疼痛' : Number(a.vas) >= 4 ? '中度疼痛' : '轻度/无痛', level: Number(a.vas) >= 7 ? 'bad' : Number(a.vas) >= 4 ? 'warn' : 'ok' } : { label: '未评定', level: '' },
    '<div class="vas-wrap"><input type="range" min="0" max="10" step="1" value="' + a.vas + '" data-vas><div class="vas-val">' + a.vas + '</div></div>' +
    '<div class="vas-scale"><span>0 无痛</span><span>3 轻度</span><span>5 中度</span><span>7 重度</span><span>10 剧痛</span></div>',
    '疼痛评分 ≥4 分需纳入疼痛管理目标；老年人、认知障碍者建议结合面部表情量表。');

  return [
    { t: 'MMSE 简易精神状态检查', h: mmse, v: isTouched(a, 'mmse') ? ms + ' 分' : '—' },
    { t: '洼田饮水试验', h: kouda, v: isTouched(a, 'kouda') ? a.kouda + ' 级' : '—' },
    { t: 'VAS 疼痛评分', h: vas, v: isTouched(a, 'vas') ? a.vas + ' 分' : '—' }
  ].concat(customCards(p, a, 'special'));
}

/* 自定义量表卡片：按注册表题型动态渲染，值落在 a.custom[def.id] */
function customScaleCard(p, a, def) {
  const v = customValues(a, def);
  const total = scaleTotal(a, def);
  const g = scaleGrade(def, total);
  const valHtml = '<span class="val">' + total + '</span><span class="max">' + (def.max ? '/' + def.max : '分') + '</span>';
  let body = '';
  if (def.kind === 'items-select') {
    body = '<div class="barthel-grid">' + def.items.map((it) => {
      const cur = Number(v[it.key] || 0);
      return '<div class="brow"><span class="bl">' + esc(it.label) + '</span><select data-assess="custom.' + def.id + '.' + it.key + '">' +
        (it.levels || []).map(([lv, l]) => '<option value="' + lv + '"' + (cur === Number(lv) ? ' selected' : '') + '>' + esc(l) + '</option>').join('') + '</select></div>';
    }).join('') + '</div>';
  } else if (def.kind === 'items-buttons04') {
    body = '<div class="berg-grid">' + def.items.map((it, i) => {
      const cur = Number(v[it.key] || 0);
      return '<div class="bgrow"><span class="n">' + String(i + 1).padStart(2, '0') + '</span><span class="t">' + esc(it.label) + '</span>' +
        '<span class="lvl-group">' + [0, 1, 2, 3, 4].map((n) => '<button data-cbtn="' + def.id + '" data-ckey="' + it.key + '" data-val="' + n + '" class="' + (cur === n ? 'on' : '') + '" title="' + n + ' 分">' + n + '</button>').join('') + '</span></div>';
    }).join('') + '</div>';
  } else if (def.kind === 'items-number') {
    body = '<div class="mmse-grid">' + def.items.map((it) => {
      const cur = Number(v[it.key] || 0);
      const mx = it.max || def.max || 10;
      return '<div class="mrow"><span class="ml">' + esc(it.label) + '</span><span class="mr"><input data-assess="custom.' + def.id + '.' + it.key + '" type="number" min="0" max="' + mx + '" value="' + cur + '"><span class="mx">/ ' + mx + '</span></span></div>';
    }).join('') + '</div>';
  } else if (def.kind === 'side-grid-select') {
    const lv = def.levels.length ? def.levels : [{ v: 0, label: '0' }, { v: 1, label: '1' }];
    body = '<div class="mmt-grid"><div class="mg-head">部位</div><div class="mg-head side-l">左侧</div><div class="mg-head side-r">右侧</div>' +
      def.items.map((it) => {
        const row = asArr(v[it.key], [lv[0].v, lv[0].v]);
        const opts = (idx) => lv.map((l) => '<option value="' + l.v + '"' + (String(row[idx]) === String(l.v) ? ' selected' : '') + '>' + esc(l.label) + '</option>').join('');
        return '<div class="mg-cell name">' + esc(it.label) + '</div><div class="mg-cell"><select data-assess="custom.' + def.id + '.' + it.key + '.0">' + opts(0) + '</select></div><div class="mg-cell"><select data-assess="custom.' + def.id + '.' + it.key + '.1">' + opts(1) + '</select></div>';
      }).join('') + '</div>';
  } else if (def.kind === 'stage-select') {
    body = '<div class="select-row">' + def.items.map((it) => '<div class="sel-field"><label>' + esc(it.label) + '</label><select data-assess="custom.' + def.id + '.' + it.key + '">' +
      def.levels.map((l) => '<option value="' + l.v + '"' + (String(v[it.key]) === String(l.v) ? ' selected' : '') + '>' + esc(l.label) + '</option>').join('') + '</select></div>').join('') + '</div>';
  } else if (def.kind === 'single-select') {
    body = '<div class="select-row" style="grid-template-columns:1fr"><div class="sel-field"><label>评定结果</label><select data-assess="custom.' + def.id + '.value">' +
      def.levels.map((l) => '<option value="' + l.v + '"' + (String(v.value) === String(l.v) ? ' selected' : '') + '>' + esc(l.label) + '</option>').join('') + '</select></div></div>';
  } else if (def.kind === 'slider') {
    body = '<div class="vas-wrap"><input type="range" min="0" max="' + (def.max || 10) + '" step="1" value="' + (Number(v.value) || 0) + '" data-cslider="' + def.id + '"><div class="vas-val">' + (Number(v.value) || 0) + '</div></div>';
  }
  const meta = def.items.length + ' 项' + (def.max ? ' · 满分 ' + def.max : '');
  const subText = def.sub ? def.sub + ' · ' + meta : meta;
  return scaleCard(def.title, subText, valHtml, g.label ? g : null, body, def.note);
}

function customCards(p, a, tab) {
  return state.customScales.filter((d) => d.tab === tab).map((d) => ({
    t: d.title, h: customScaleCard(p, a, d), custom: true, v: hasCustomValue(a, d) ? scaleTotal(a, d) : '—'
  }));
}

/* 量表目录：按页签列出常用量表；内置/已加入标灰，候选量表可一键加入自定义量表区 */
function catalogStatus(it) {
  const defs = allScaleDefs();
  if (it.catId) return defs.some((d) => d.id === 'u_' + it.catId) ? 'added' : 'available';
  return defs.some((d) => (d.title || '').indexOf(it.refTitle) >= 0) ? it.status : 'missing';
}

function renderScaleCatalog(tab) {
  const items = (typeof SCALE_CATALOG !== 'undefined' ? SCALE_CATALOG : []).filter((x) => x.tab === tab);
  if (!items.length) return '';
  const rows = items.map((it) => {
    const st = catalogStatus(it);
    const name = it.title || it.refTitle;
    if (st === 'available') {
      const meta = '<div class="scat-meta"><span class="scat-title">' + esc(name) + '</span>' +
        (it.sub ? '<span class="scat-sub">' + esc(it.sub) + '</span>' : '') +
        (it.source ? '<span class="scat-src">' + esc(it.source) + '</span>' : '') + '</div>';
      return '<div class="scat-row">' + meta + '<button class="btn small" data-cat-add="' + it.catId + '">加入</button></div>';
    }
    const tag = st === 'builtin' ? '内置' : '已加入';
    return '<div class="scat-row added"><div class="scat-meta"><span class="scat-title">' + esc(name) + '</span><span class="scat-tag">' + tag + '</span></div>' +
      '<button class="btn small outline" data-cat-open="' + esc(it.catId || it.refTitle || name) + '">去录入</button></div>';
  }).join('');
  const def = { id: '__catalog_' + tab, title: '量表目录', sub: '从常用量表库自由勾选加入，已在评估页的量表不可重复添加' };
  if (!(def.id in state.collapsedScale)) state.collapsedScale[def.id] = true;
  const body = '<div class="scat-list">' + rows + '</div><div class="scale-note">候选量表为简式总分/分级录入，分项赋分与 cutoff 阈值须按量表原版核对后再正式使用；神经调控、机器人等需具备设备与适应证评估后由医师开具。</div>';
  return scaleCard(def.title, def.sub, '', { label: '', level: 'ok' }, body, '', '', def.id);
}

/* 从量表目录「去录入」：切到该量表所在页签、选中它、展开卡，并把视图滚到录入区 */
function openScaleByName(name) {
  const p = P(); const a = p && latest(p);
  if (!a) { toast('该患者还没有评估记录，先点「开始首次评估」'); return; }
  const key = asStr(name);
  const lists = { motor: assessMotor(p, a), func: assessFunc(p, a), special: assessSpecial(p, a) };
  let hit = null, hitTab = '';
  ['motor', 'func', 'special'].forEach((t) => {
    if (hit) return;
    const f = (lists[t] || []).filter((x) => x.t === key || asStr(x.t).indexOf(key) >= 0 || key.indexOf(asStr(x.t)) >= 0);
    if (f.length) { hit = f[0]; hitTab = t; }
  });
  if (!hit) { toast('这个量表还没加入，请先点「加入」'); return; }
  state.assessTab = hitTab;
  const pk = scalePickOf(hitTab);
  pk[hit.t] = true;
  state.collapsedScale[hit.t] = false;
  renderView();
  setTimeout(() => { const el = document.querySelector('.pk-cards'); if (el && el.scrollIntoView) el.scrollIntoView({ block: 'center' }); }, 40);
  toast('已打开「' + shortScaleName(hit.t) + '」，可以开始录分');
}

/* 目录候选量表一键加入自定义量表区；重复加入不建卡 */
function addCatalogScale(catId) {
  const item = (typeof SCALE_CATALOG !== 'undefined' ? SCALE_CATALOG : []).find((x) => x.catId === catId);
  if (!item) return;
  const uid2 = 'u_' + catId;
  if (state.customScales.some((d) => d.id === uid2)) { renderView(); renderHead(); return; }
  const raw = {
    id: uid2, title: item.title, sub: item.sub, tab: item.tab, kind: item.kind,
    max: item.max || 0, note: item.note, inTrend: true, inNarrative: true,
    levels: item.levels || []
  };
  if (item.kind === 'items-number') raw.items = [{ key: 'total', label: '总分（按原版逐项评定后录入）', max: item.max || 10 }];
  const def = normalizeScaleDef(raw);
  if (!def) return;
  state.customScales.push(def);
  if (!(def.title in state.collapsedScale)) state.collapsedScale[def.title] = true;
  scheduleSave(); renderView(); renderHead();
  toast('已加入「' + shortScaleName(def.title) + '」，回评估页点这个名字就能录分');
}

function trendCard(p) {
  const palette = ['#0e6b58', '#b08a3e', '#3e7cb0', '#8a6bb0', '#b05a5a', '#5a9a8a', '#a8763e'];
  /* 只画"同一量表评过两次以上"的曲线：未录的量表没有数据，
     画成 0→0 的平线等于在看报告的人眼前写下"这项 0 分" */
  const charts = allScaleDefs().filter((d) => d.inTrend).map((d, i) => ({
    label: d.title, color: palette[i % palette.length], max: d.max || 100,
    pts: p.assessments
      .filter((x) => (d.builtin ? isTouched(x, d.id) : hasCustomValue(x, d)))
      .map((x) => ({ d: x.date, v: scaleTotal(x, d) }))
  })).filter((c) => c.pts.length >= 2);
  if (p.assessments.length < 2) {
    return '<div class="chart-card"><div class="chart-head"><h4>功能变化趋势</h4></div><div class="trend-empty">完成 2 次及以上评估后，自动生成量表变化曲线</div></div>';
  }
  if (!charts.length) {
    return '<div class="chart-card"><div class="chart-head"><h4>功能变化趋势</h4></div><div class="trend-empty">同一量表评满 2 次后才会出曲线；本次只录了单次评分，暂不成图（未评定的量表也不会画成 0 分）。</div></div>';
  }
  const legend = charts.map((c) => '<span><i style="background:' + c.color + '"></i>' + esc(c.label) + '</span>').join('');
  const grid = '<div style="display:grid;grid-template-columns:1fr 1fr;gap:18px">' + charts.map((c) => trendSvg(c.pts, c.max, c.color, c.label)).join('') + '</div>';
  return '<div class="chart-card"><div class="chart-head"><h4>功能变化趋势</h4><div class="legend">' + legend + '</div></div>' + grid + '</div>';
}

function trendSvg(points, max, color, label) {
  const W = 300, H = 150, padL = 30, padR = 12, padT = 14, padB = 22;
  const gid = 'g' + label.replace(/[^A-Za-z0-9]/g, '');
  const n = points.length;
  const x = (i) => padL + (n <= 1 ? 0 : (i * (W - padL - padR)) / (n - 1));
  const y = (v) => padT + (1 - v / max) * (H - padT - padB);
  const line = points.map((pt, i) => (i === 0 ? 'M' : 'L') + x(i).toFixed(1) + ' ' + y(pt.v).toFixed(1)).join(' ');
  const area = line + ' L' + x(n - 1).toFixed(1) + ' ' + (H - padB) + ' L' + x(0).toFixed(1) + ' ' + (H - padB) + ' Z';
  const grid = [0, 0.5, 1].map((f) => '<line x1="' + padL + '" x2="' + (W - padR) + '" y1="' + y(max * f) + '" y2="' + y(max * f) + '" stroke="#eae5da" stroke-width="1" stroke-dasharray="3 4"/>' +
    '<text x="' + (padL - 5) + '" y="' + (y(max * f) + 3) + '" text-anchor="end" font-size="8" fill="#9aa69f">' + Math.round(max * f) + '</text>').join('');
  const dots = points.map((pt, i) => '<circle cx="' + x(i) + '" cy="' + y(pt.v) + '" r="3" fill="#fffdf8" stroke="' + color + '" stroke-width="1.8"/>' +
    '<text x="' + x(i) + '" y="' + (y(pt.v) - 7) + '" text-anchor="middle" font-size="9" font-weight="600" fill="' + color + '">' + pt.v + '</text>' +
    '<text x="' + x(i) + '" y="' + (H - 7) + '" text-anchor="middle" font-size="8" fill="#9aa69f">' + monthDay(pt.d) + '</text>').join('');
  return '<svg class="trend-svg" viewBox="0 0 ' + W + ' ' + H + '" preserveAspectRatio="none">' +
    '<defs><linearGradient id="' + gid + '" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="' + color + '" stop-opacity=".16"/><stop offset="1" stop-color="' + color + '" stop-opacity="0"/></linearGradient></defs>' +
    grid + '<path d="' + area + '" fill="url(#' + gid + ')"/><path d="' + line + '" fill="none" stroke="' + color + '" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/>' + dots + '</svg>';
}

/* ---------------- 病程记录 ---------------- */
/* 训练项目按类别分组渲染：项目库扩到 60 项后按 PT/OT/ST/理疗… 分段，避免挤成一片 */
function groupedTrainChips(selected) {
  const sel = Array.isArray(selected) ? selected : [];
  const cats = [];
  PLAN_PHRASES.forEach((x) => { if (cats.indexOf(x.cat) < 0) cats.push(x.cat); });
  return cats.map((cat) =>
    '<span class="pick-cat">' + esc(cat) + '</span>' +
    PLAN_PHRASES.filter((x) => x.cat === cat).map((x) => {
      const t = x.full;
      return '<button class="pick' + (sel.indexOf(t) >= 0 ? ' on' : '') + '" data-pick="' + esc(t) + '">' + esc(t) + '</button>';
    }).join('')
  ).join('');
}

function defaultCompose(p) {
  // 根据当前患者的病种自动匹配病程分类和默认训练项目
  const key = p ? (p.diseaseKey || detectDisease((p.record?.present || '') + ' ' + (p.diagShort || ''))) : 'geriatric';
  const cat = DISEASE_TO_COMPOSE_CAT[key] || '老年病';
  const defaultItems = {
    '脑卒中': ['偏瘫肢体综合训练', '平衡训练'],
    '骨科': ['关节松动训练', '肌力训练'],
    '老年病': ['肌力训练', '平衡训练'],
    '神经康复': ['偏瘫肢体综合训练', '肌力训练'],
    '认知康复': ['认知训练', '作业治疗（ADL）'],
    '疼痛康复': ['物理因子治疗', '推拿'],
    '血管康复': ['肌力训练', '步态训练']
  }[cat] || ['综合康复治疗'];
  const mental = { '脑卒中': '神志清，精神可', '骨科': '神志清，精神可', '老年病': '精神平稳，情绪可', '神经康复': '神志清，精神可', '认知康复': '神志清，定向力可', '疼痛康复': '神志清，情绪可', '血管康复': '神志清，精神可' }[cat] || '神志清，精神可';
  const strength = { '脑卒中': '患肢肌力较前提升', '骨科': '关节活动度较前改善', '老年病': '体能较前好转', '神经康复': '患肢肌力较前提升', '认知康复': '认知反应较前好转', '疼痛康复': '疼痛部位肌力维持尚可', '血管康复': '下肢循环较前改善' }[cat] || '功能较前改善';
  const tone = { '脑卒中': '肌张力偏高', '骨科': '肌张力正常', '老年病': '肌张力正常', '神经康复': '肌张力正常', '认知康复': '肌张力正常', '疼痛康复': '肌张力正常', '血管康复': '肌张力正常' }[cat] || '肌张力正常';
  const balance = { '脑卒中': '坐位平衡改善', '骨科': '转移平稳', '老年病': '站立平衡改善', '神经康复': '平衡能力逐步改善', '认知康复': '转移平稳', '疼痛康复': '活动平稳', '血管康复': '行走耐力较前好转' }[cat] || '平衡改善';
  const swallow = p && Array.isArray(p.assessments) && p.assessments.some(a => Number(a.kouda) >= 3) ? '饮水偶有呛咳' : '吞咽正常';
  const pain = p && latest(p) && Number(latest(p).vas) >= 4 ? '活动时疼痛减轻' : '无明显疼痛';
  return { cat, items: defaultItems, mental, strength, tone, balance, swallow, pain, trend: '较前改善', med: [], extra: '', noteType: 'daily' };
}

function composeText(p) {
  const c = state.compose;
  const items = c.items.length ? c.items.join('、') : '综合康复治疗';
  const hemiplegia = c.cat === '脑卒中' && p.side && p.side !== '双侧' ? p.side + '侧肢体偏瘫，' : '';
  const trendText = { '较前改善': '功能较前改善', '病情平稳': '病情平稳，功能维持尚可', '略有退步': '功能较前略有退步，已分析原因并调整训练方案' }[c.trend] || '功能较前改善';
  let s = '患者' + c.mental + '，' + hemiplegia + c.strength + '，' + c.tone + '，' + c.balance + '，' + c.swallow + '，' + c.pain + '，' + trendText + '，';
  const medTexts = MED_POINTS.filter((m) => (c.med || []).indexOf(m.key) >= 0).map((m) => m.text);
  if (medTexts.length) s += medTexts.join('；') + '，';
  else s += '饮食二便正常，';
  s += '继续' + items + '。';
  if (c.extra.trim()) s += c.extra.trim();
  return s;
}

/* 内科 / 卧床并发症要点：按分组勾选，纳入当日病程初稿；诊断、用药与剂量须主管医师核实后归档 */
function medGroupRows(c) {
  const groups = [];
  MED_POINTS.forEach((m) => { if (groups.indexOf(m.group) < 0) groups.push(m.group); });
  return groups.map((g) => {
    const btns = MED_POINTS.filter((m) => m.group === g).map((m) =>
      '<button class="pick' + ((c.med || []).indexOf(m.key) >= 0 ? ' on' : '') + '" data-med="' + esc(m.key) + '">' + esc(m.label) + '</button>').join('');
    return '<div class="med-group"><span class="med-g">' + esc(g) + '</span><span class="pick-row">' + btns + '</span></div>';
  }).join('');
}

/* 病程骨架：首次病程三段式 / 上级查房抬头；均为可修改初稿，__ 处须人工核实补全（K13/K17） */
function noteSkeleton(p, type) {
  const r = p.record || {};
  if (type === 'first') {
    const diag = (r.diagnoses || []).join('；') || '__ 初步诊断';
    return '【病例特点】\n' +
      '1. 患者' + (p.name || '__') + '，' + (p.gender || '—') + '，' + (p.age !== '' ? p.age : '__') + ' 岁，因「' + (r.chief || '__ 主诉') + '」入院。\n' +
      '2. 现病史：' + (r.present ? r.present.replace(/[。；;，,、\s]+$/, '') + '。' : '__ 起病时间、形式、症状演变、诊疗经过与目前功能状态') + '\n' +
      '3. 既往史 / 查体 / 评定摘要：__（补充既往史、专科查体与最近一次评定结果）。\n' +
      '【诊断与鉴别分析】\n' +
      '初步诊断：' + diag + '。\n' +
      '鉴别诊断：__（按支持点、不支持点、建议检查逐项分析）。\n' +
      '【康复计划与指导】\n' +
      '近期目标：' + (r.goalsShort || '__') + '；康复方案：' + (r.plan || '__') + '；已行跌倒 / 压疮 / 误吸风险告知及家属沟通。';
  }
  if (type === 'round') {
    const who = state.supervisor ? ((state.doctorTitle ? state.doctorTitle + ' ' : '') + state.supervisor) : doctorLabel();
    return todayISO() + ' ' + nowHM() + '　【' + who + '】查房记录\n' +
      '查房意见：__（上级医师对病情、功能恢复与方案的判断）。\n' +
      '查体 / 评定：__（肌力、肌张力、平衡、ADL 等本次复查结果）。\n' +
      '处理调整：__（方案调整、训练重点与注意事项）。';
  }
  return '';
}

function viewCourse(p) {
  const a = latest(p);
  const c = state.compose || defaultCompose(p);
  const cats = ['脑卒中', '骨科', '老年病', '神经康复', '认知康复', '疼痛康复', '血管康复'];
  const mentalOpts = ['神志清，精神可', '神志清，精神一般', '精神平稳，情绪可', '精神稍弱，易疲劳'];
  const strengthOpts = ['患肢肌力较前提升', '患肢肌力改善不明显', '患肢肌力稳步恢复', '四肢肌力正常，体能偏弱'];
  const toneOpts = ['肌张力偏高', '肌张力较前下降', '肌张力正常', '肌张力明显增高'];
  const balanceOpts = ['可自主翻身，坐位平衡改善', '坐位平衡欠佳，易倾倒', '可扶站，站立平衡改善', '转移需中等帮助'];
  const swallowOpts = ['饮水偶有呛咳', '吞咽功能较前改善', '吞咽正常，无呛咳', '留置胃管鼻饲'];
  const painOpts = ['无明显疼痛', '疼痛较前减轻', '活动时疼痛明显', '夜间疼痛影响睡眠'];
  const trendOpts = ['较前改善', '病情平稳', '略有退步'];

  const sel = (key, label, opts) => '<div class="gen-row"><label>' + label + '</label><select data-compose="' + key + '">' +
    opts.map((o) => '<option' + (c[key] === o ? ' selected' : '') + '>' + o + '</option>').join('') + '</select></div>';

  const typeOpts = [['daily', '日常病程'], ['first', '首次病程'], ['round', '上级查房']];
  const typeLabel = NOTE_TYPE_LABEL[c.noteType] || '日常病程';
  const editing = state.editingNoteId ? p.notes.find((n) => n.id === state.editingNoteId) : null;
  const composer = '<div class="composer"><h4>' + (editing ? '编辑' : '') + typeLabel + '记录</h4><div class="csub">' +
    (editing ? '正在编辑 ' + esc(editing.date) + ' 的' + typeLabel + '记录：保存后替换原记录，取消编辑则原记录保持不变。'
      : (c.noteType === 'daily' ? '按今日查房情况选择要点，生成后可自由修改并保存入病历时间线。' : '套用对应骨架初稿，__ 处与评定数据须人工核实补全，不可直接签字归档。')) + '</div>' +
    '<div class="compose-grid">' +
      '<div class="gen-row full"><label>记录类型</label><select data-compose="noteType" style="max-width:220px">' + typeOpts.map(([v, l]) => '<option value="' + v + '"' + (c.noteType === v ? ' selected' : '') + '>' + l + '</option>').join('') + '</select></div>' +
      '<div class="gen-row full"><label>病种分类</label><select data-compose="cat" style="max-width:260px">' + cats.map((x) => '<option' + (c.cat === x ? ' selected' : '') + '>' + x + '</option>').join('') + '</select></div>' +
      '<div class="gen-row full"><label>训练项目（可多选）</label><div class="pick-row">' + groupedTrainChips(c.items) + '</div></div>' +
      '<div class="gen-row full"><label>内科 / 卧床并发症要点（可多选，当日无则留空；诊断与用药须医师核实）</label>' + medGroupRows(c) + '</div>' +
      sel('mental', '精神状态', mentalOpts) + sel('strength', '肌力', strengthOpts) +
      sel('tone', '肌张力', toneOpts) + sel('balance', '转移与平衡', balanceOpts) +
      sel('swallow', '吞咽', swallowOpts) + sel('pain', '疼痛', painOpts) + sel('trend', '趋势判断', trendOpts) +
      '<div class="full"><label style="font-size:10.5px;color:var(--muted);display:block;margin-bottom:5px">补充说明（可选）<button class="voice-btn" data-action="voice-draft" title="语音输入（需 Chrome/Edge）">🎤 语音输入</button></label>' +
        '<textarea class="note-draft" data-draft placeholder="在此输入、口述或从右侧语句库插入…">' + esc(state.draft) + '</textarea></div>' +
      '<div class="full"><label style="font-size:10.5px;color:var(--muted);display:block;margin-bottom:5px">不良事件（可选，当日无则留空）</label>' +
        '<input class="note-adverse" data-adverse placeholder="如：训练后局部肌肉酸痛，休息后缓解；无跌倒、眩晕及其他不适" value="' + esc(state.noteAdverse) + '"></div>' +
    '</div>' +
    '<div class="composer-actions">' +
      '<button class="btn small outline" data-action="gen-draft">按选项生成</button>' +
      '<button class="btn small outline" data-action="note-skeleton">套用' + typeLabel + '骨架</button>' +
      (a ? '<button class="btn small outline" data-action="gen-draft-assess">按本次评估生成</button>' : '') +
      '<span class="count-tip">' + (state.draft ? state.draft.length + ' 字' : '草稿为空') + '</span><span class="spacer"></span>' +
      '<button class="btn small outline" data-action="clear-draft">清空</button>' +
      (editing ? '<button class="btn small outline" data-action="cancel-edit">取消编辑</button>' : '') +
      '<button class="btn solid small" data-action="submit-note">' + (editing ? '保存修改' : '保存病程') + '</button>' +
    '</div></div>';

  // 同一天内按写入顺序倒序（后写的在前），避免新记录被稳定排序压到当天最下面
  const list = p.notes.map((n, i) => ({ n, i })).sort((x, y) => (dateTs(y.n.date) - dateTs(x.n.date)) || (y.i - x.i)).map((x) => x.n);
  const timeline = list.length ? '<div class="timeline">' + list.map((n) => {
    const pending = state.pendingDeleteId === n.id;
    return '<div class="tl-item' + (n.date === todayISO() ? ' new' : '') + '"><div class="tl-card"><div class="tl-top"><span class="tl-date">' + esc(n.date) + '</span>' +
    '<span class="tl-type">' + esc(NOTE_TYPE_LABEL[n.type] || '日常病程') + '</span><span class="tl-author">' + esc(n.author || state.doctor) + '</span></div>' +
    '<div class="tl-body">' + esc(n.text) + '</div>' +
    ((n.adverse || '').trim() ? '<div class="tl-adverse">不良事件：' + esc(n.adverse) + '</div>' : '') +
    '<div class="tl-actions"' + (pending ? ' style="opacity:1"' : '') + '><button data-action="edit-note" data-id="' + n.id + '">编辑</button><button data-action="copy-note" data-id="' + n.id + '">复制</button>' +
    (pending
      ? '<button data-action="del-note" data-id="' + n.id + '" style="color:var(--accent);font-weight:600">确认删除</button><button data-action="cancel-del">取消</button>'
      : '<button data-action="del-note" data-id="' + n.id + '">删除</button>') +
    '</div></div></div>';
  }).join('') + '</div>'
    : '<div class="blank">尚无病程记录。用上方生成器、日程模板或右侧语句库快速书写第一条。</div>';

  const ddx = p.record.diffDx || {};
  const schedKey = ddx.key && COURSE_SCHEDULE[ddx.key] ? ddx.key : detectDisease((p.record.present || '') + ' ' + (p.diagShort || ''));
  const schedName = (DISEASE_KEYWORDS.find((x) => x.key === schedKey) || {}).name || '老年慢病';
  const sched = '<div class="chart-card" style="padding:14px 18px 18px"><div class="chart-head"><h4>病程日程模板</h4>' +
    '<div class="legend"><span>病种：' + esc(schedName) + ' · 点卡片填入草稿，__ 处按实际修改</span></div></div>' +
    '<div class="sched-grid">' + (COURSE_SCHEDULE[schedKey] || COURSE_SCHEDULE['geriatric']).map((s, i) =>
      '<button class="sched-card" data-sched="' + i + '" data-sched-day="' + esc(s.day) + '" data-sched-text="' + esc(s.text) + '"><span class="sched-day">' + esc(s.day) + '</span><span class="sched-text">' + esc(s.text) + '</span><span class="sched-ins">＋ 填入草稿</span></button>').join('') + '</div></div>';

  return '<div class="stack">' + composer + sched +
    '<div class="chart-card" style="padding:14px 18px 18px"><div class="chart-head"><h4>病程时间线</h4>' +
    '<div class="legend"><span>' + p.notes.length + ' 条记录</span></div></div><div style="margin-top:14px">' + timeline + '</div></div></div>';
}

/* ---------------- 出院记录 ---------------- */
function viewDischarge(p) {
  const d = p.discharge || (p.discharge = { date: '', summary: '', advice: [], followUp: '', templateKey: '', checked: [] });
  const days = d.date ? daysBetween(p.admitDate, d.date) : daysBetween(p.admitDate);
  const templates = Object.keys(DISCHARGE_TEMPLATES).map((k) => {
    const t = DISCHARGE_TEMPLATES[k];
    return '<button class="tpl-card' + (d.templateKey === k ? ' on' : '') + '" data-tpl="' + k + '"><b>' + esc(t.name) + '</b><span>' + esc(t.note) + '，共 ' + t.items.length + ' 条</span></button>';
  }).join('');
  const advice = d.advice.length ? d.advice.map((item, i) => {
    const on = d.checked.indexOf(i) >= 0;
    return '<div class="advice-item' + (on ? '' : ' off') + '"><button class="checkbox' + (on ? ' on' : '') + '" data-action="toggle-advice" data-i="' + i + '">' +
      (on ? '<svg viewBox="0 0 24 24" class="ic"><path d="m5 13 4 4L19 7"/></svg>' : '') + '</button>' +
      '<input type="text" data-advice="' + i + '" value="' + esc(item) + '">' +
      '<button class="rm" data-action="remove-advice" data-i="' + i + '" title="删除">×</button></div>';
  }).join('') : '<div class="blank" style="padding:18px">选择上方医嘱模板，或手动添加条目。</div>';

  return '<div class="stack"><div class="sheet">' +
    '<div class="sheet-head"><h3>出 院 记 录</h3><span class="sheet-no">NO. ' + esc(p.mrn) + '</span></div>' +
    '<div class="sheet-sub"><span>姓名 ' + esc(p.name) + '　' + esc(p.gender) + '　' + p.age + ' 岁　床号 ' + esc(p.bed) + '</span><span>住院 ' + days + ' 天</span></div>' +

    '<div class="section" style="padding-top:16px"><h4 class="section-title"><span class="idx">01</span>出院信息</h4>' +
      '<div class="form-grid three">' +
        field('入院日期', 'admitDate', p.admitDate, { type: 'date' }) +
        field('出院日期', 'discharge.date', d.date, { type: 'date' }) +
        '<div class="field"><label>住院天数</label><div class="readonly-value">' + days + ' 天</div></div>' +
      '</div>' +
      '<div class="form-grid" style="margin-top:8px">' +
        field('出院诊断（主要）', 'diagShort', p.diagShort, { wide: true }) +
      '</div>' +
    '</div>' +

    '<div class="section"><h4 class="section-title"><span class="idx">02</span>出院小结</h4>' +
      '<div class="form-grid one">' + field('入院情况与诊疗经过 / 出院情况', 'discharge.summary', d.summary, { type: 'textarea', rows: 6, ph: '入院时主要症状与功能状态、主要治疗、出院时功能改善情况。' }) + '</div>' +
      '<div style="display:flex;gap:8px;margin-top:8px"><button class="btn small solid" data-action="gen-discharge">按病历与评估自动生成</button>' +
      '<button class="btn small outline" data-action="gen-goals">刷新康复目标</button></div>' +
    '</div>' +

    '<div class="section"><h4 class="section-title"><span class="idx">03</span>出院医嘱</h4>' +
      '<div class="tpl-select">' + templates + '</div>' +
      '<div class="advice-list">' + advice + '</div>' +
      '<div style="margin-top:10px;display:flex;gap:8px;align-items:center"><button class="add-inline" data-action="add-advice">+ 添加医嘱条目</button>' +
      '<span style="font-size:10.5px;color:var(--faint)">勾选的项目将写入打印稿，可逐条修改</span></div>' +
    '</div>' +

    '<div class="section"><h4 class="section-title"><span class="idx">04</span>复诊与随访</h4>' +
      '<div class="form-grid">' +
        field('复诊建议', 'discharge.followUp', d.followUp, { type: 'select', options: ['', ...FOLLOW_UP_OPTIONS] }) +
        field('出院去向', 'discharge.dest', d.dest || '居家', { type: 'select', options: ['居家', '社区康复机构', '养老机构', '转院继续治疗'] }) +
      '</div>' +
    '</div>' +

    '<div class="sheet-foot"><div class="stamp">康复医学科<br>病历专用章</div>' +
      '<div class="sign"><div class="sign-line"></div><span>经治医师：' + esc(doctorLabel()) + '　' + (d.date || todayISO()) + '</span>' +
      (state.supervisor ? '<div class="sign-line"></div><span>审核医师：' + esc(state.supervisor) + '</span>' : '') + '</div></div>' +
  '</div></div>';
}

/* ---------------- 质控 ---------------- */
function computeQC() {
  const p = P();
  const a = latest(p);
  const b = a ? barthelTotal(a) : 0;
  const checkedAdvice = (p.discharge && p.discharge.advice.filter((_, i) => p.discharge.checked.indexOf(i) >= 0).length) || 0;
  const isDischarged = p.status === '已出院';
  const d = p.discharge || {};
  const checks = [
    { id: 'chief', label: '主诉已填写', sub: '症状 + 持续时间', active: true, pass: (p.record.chief || '').trim().length >= 6, tab: 'admit', sec: 'chief' },
    { id: 'present', label: '现病史完整', sub: '建议 ≥30 字，含诊疗经过', active: true, pass: (p.record.present || '').trim().length >= 30, tab: 'admit', sec: 'chief' },
    { id: 'past', label: '既往史已填写', sub: '含基础病与用药', active: true, pass: (p.record.past || '').trim().length >= 4, tab: 'admit', sec: 'chief' },
    { id: 'vitals', label: '生命体征完整', sub: '体温、脉搏、呼吸、血压', active: true, pass: !!(p.record.vitals.bp && p.record.vitals.t), tab: 'admit', sec: 'exam' },
    { id: 'neuro', label: '专科查体已记录', sub: '肌力、肌张力、感觉', active: true, pass: (p.record.neuro || '').trim().length >= 15, tab: 'admit', sec: 'exam' },
    { id: 'diag', label: '初步诊断已列出', sub: '至少 1 条', active: true, pass: p.record.diagnoses.length >= 1, tab: 'admit', sec: 'diag' },
    { id: 'assess', label: '完成康复评定', sub: '至少 1 次规范化评估', active: true, pass: p.assessments.length >= 1, tab: 'assess' },
    { id: 'goal', label: '康复目标可量化', sub: '短期与长期目标', active: true, pass: !!(p.record.goalsShort && p.record.goalsLong), tab: 'admit', sec: 'goal' },
    { id: 'notes', label: '已书写病程记录', sub: '住院期间至少 1 条', active: true, pass: p.notes.length >= 1 || p.status === '门诊', tab: 'course' },
    { id: 'ddx', label: '鉴别诊断已书写', sub: '≥3 条鉴别要点', active: true, pass: (p.record.diffDx.items || []).length >= 3, tab: 'admit', sec: 'ddx' },
    { id: 'plan', label: '康复治疗方案已填写', sub: 'PT / OT / ST / 理疗', active: true, pass: (p.record.plan || '').trim().length >= 10, tab: 'admit', sec: 'goal' },
    // 出院类项目：仅在患者已出院时纳入考核，在院/门诊阶段显示为「待出院」，不计入完整度分母
    { id: 'discharge', label: '出院医嘱 ≥6 条', sub: '勾选有效条目', active: isDischarged, pass: checkedAdvice >= 6, tab: 'discharge' },
    { id: 'dSummary', label: '出院小结已书写', sub: '入院情况、治疗经过与转归', active: isDischarged, pass: (d.summary || '').trim().length >= 20, tab: 'discharge' },
    { id: 'followUp', label: '复诊随访已安排', sub: '复诊时间与随访方式', active: isDischarged, pass: !!(d.followUp || '').trim(), tab: 'discharge' }
  ];
  const activeChecks = checks.filter((c) => c.active);
  const pass = activeChecks.filter((c) => c.pass).length;
  return { checks, score: activeChecks.length ? Math.round((pass / activeChecks.length) * 100) : 100, pass, total: activeChecks.length, barthel: b };
}

/* ---------------- 右侧助手 ---------------- */
function renderAssistant() {
  const p = P();
  $('#assistantTabs').querySelectorAll('.seg').forEach((b) => b.classList.toggle('active', b.dataset.atab === state.atab));
  const body = $('#assistantBody');
  if (!p) { body.innerHTML = '<div class="blank" style="padding:18px 14px">有患者后，这里会显示查房语句、诊断参考与质控得分。</div>'; return; }
  if (state.atab === 'notes') body.innerHTML = assistantNotes();
  else if (state.atab === 'diagnosis') body.innerHTML = assistantDiagnosis(p);
  else if (state.atab === 'compose') body.innerHTML = assistantCompose(p);
  else body.innerHTML = assistantQC();
}

/* bingli hints.js 47 条诊断规则 —— 扫描当前病历内容，返回命中的诊断提示 */
function assistantDiagnosis(p) {
  if (typeof BINGLI_HINTS === 'undefined') return '<div class="blank">诊断规则库未加载</div>';

  // 1. 收集"发现清单"。编码体系与 hints-bingli.js 规则严格对齐：
  //    cc:症状 / ros:系统.症状 / pmh:疾病 / pe:组.条目 / pev:组.条目=值 / vital:xxx / aux:xxx
  const rawText = [p.record.chief, p.record.present, p.diagShort, p.record.exam, p.record.neuro, p.record.past, p.record.aux, p.record.problems.join('；')].filter(Boolean).join('\n');
  const text = rawText.toLowerCase();
  const findings = new Set();

  // cc（主诉关键词）—— 取常见症状词
  const CC_WORDS = ['发热','咳嗽','咳痰','胸痛','气促','喘息','咯血','盗汗','消瘦','腹痛','腹胀','恶心','呕吐','黑便','呕血','黄疸','腰痛','血尿','尿频','尿急','尿痛','水肿','头晕','头痛','心悸','胸闷','乏力','体重减轻','多饮','多尿','关节痛','晨僵','肌肉酸痛','皮疹','麻木','无力','言语不清','吞咽困难','呛咳','视力模糊','抽搐','昏迷','精神差','眩晕','耳鸣','上腹痛','右上腹痛','转移性右下腹痛','记忆力下降'];
  CC_WORDS.forEach(w => { if (text.indexOf(w.toLowerCase()) >= 0) findings.add('cc:' + w); });

  // ros 系统回顾：优先读取已勾选的三态结果（编码 = ros:系统key.症状key，与规则一致）；
  // 未点选时再按 schema 症状 label 从自由文本兜底匹配。
  const rosData = p.record.ros || {};
  if (typeof BINGLI_SCHEMA !== 'undefined' && Array.isArray(BINGLI_SCHEMA.ROS)) {
    BINGLI_SCHEMA.ROS.forEach(g => {
      const sys = rosData[g.key] || {};
      g.symptoms.forEach(s => {
        const cur = sys[s.key];
        if (cur && cur.checked) findings.add('ros:' + g.key + '.' + s.key);
        else if (!cur && s.label && text.indexOf(s.label.toLowerCase()) >= 0) findings.add('ros:' + g.key + '.' + s.key);
      });
    });
  }

  // pe / pev 查体：读取已点选的查体项，非空且非默认值即记为异常（pe:组.条目），并带上具体值（pev:组.条目=值）
  const peData = p.record.pe || {};
  if (typeof BINGLI_SCHEMA !== 'undefined') {
    const peGroupsAll = [].concat(
      Array.isArray(BINGLI_SCHEMA.PE_COMMON) ? BINGLI_SCHEMA.PE_COMMON : [],
      BINGLI_SCHEMA.PE_SPECIAL ? Object.entries(BINGLI_SCHEMA.PE_SPECIAL).map(([key, g]) => ({ key, ...g })) : []
    );
    peGroupsAll.forEach(g => {
      const gData = peData[g.key] || {};
      (g.items || []).forEach(it => {
        const val = (gData[it.key] || '').trim();
        if (!val) return;
        if (it.default && val === it.default) return;
        findings.add('pe:' + g.key + '.' + it.key);
        findings.add('pev:' + g.key + '.' + it.key + '=' + val);
      });
    });
  }

  // pmh 既往史疾病
  const PMH_LIST = ['高血压','糖尿病','冠心病','心力衰竭','脑卒中','慢性肾脏病','慢性阻塞性肺疾病','哮喘','肝硬化','甲状腺功能亢进','甲状腺功能减退','肺结核','慢性乙型肝炎','胆囊结石','消化性溃疡','精神分裂症','癫痫','肿瘤','慢阻肺'];
  PMH_LIST.forEach(d => { if (text.indexOf(d.toLowerCase()) >= 0) findings.add('pmh:' + d); });

  // vitals 生命体征
  const v = p.record.vitals || {};
  if (v.t && Number(v.t.replace(/[^\d.]/g, '')) >= 37.5) findings.add('vital:tempUp');
  if (v.p && Number(v.p.replace(/[^\d.]/g, '')) >= 100) findings.add('vital:tachy');
  if (v.r && Number(v.r.replace(/[^\d.]/g, '')) >= 22) findings.add('vital:tachypnea');
  if (v.bp) {
    const parts = v.bp.split('/').map(x => Number(x.replace(/[^\d]/g, '')));
    if (parts.length === 2 && parts[0] >= 140) findings.add('vital:bpUp');
    if (parts.length === 2 && parts[0] > 0 && parts[0] < 90) findings.add('vital:bpDown');
  }

  // aux 辅助检查：从病史/查体文本里识别检查项目关键词（编码 aux:关键词，与规则 match 对齐）
  const AUX_WORDS = ['CT','MRI','胸片','超声','胃镜','心电图','超声心动图','淀粉酶','脂肪酶','血培养','肺功能','大便','尿蛋白','幽门螺杆菌','脑电图','肌电图','腰椎穿刺','脑脊液'];
  AUX_WORDS.forEach(w => { if (text.indexOf(w.toLowerCase()) >= 0) findings.add('aux:' + w); });

  // pev 查体异常（自由文本兜底：record.exam / record.neuro 里的体征关键词）
  const PEV_PATTERNS = [
    { key: 'pev:chest.lungAuscultation=双肺可闻及湿性啰音', match: /湿性啰音|湿啰音/ },
    { key: 'pev:chest.lungAuscultation=呼吸音减弱', match: /呼吸音减弱/ },
    { key: 'pev:chest.chestShape=桶状胸', match: /桶状胸/ },
    { key: 'pev:chest.lungPercussion=双肺叩诊过清音', match: /过清音/ },
    { key: 'pev:neck.neckVessel=颈静脉怒张', match: /颈静脉怒张/ },
    { key: 'pev:chest.heartPercussion=心界向左下扩大', match: /心界.*向左下扩大|心界扩大/ },
    { key: 'pev:chest.heartAuscultation=心律不齐，可闻及早搏', match: /心律不齐|绝对不齐|脉搏短绌/ },
    { key: 'pev:chest.heartAuscultation=可闻及奔马律', match: /奔马律/ },
    { key: 'pev:abdomen.abdPalpation=上腹部压痛，无反跳痛', match: /上腹部压痛/ },
    { key: 'pev:abdomen.abdPalpation=右下腹压痛、反跳痛', match: /右下腹.*压痛/ },
    { key: 'pev:abdomen.abdPercussion=移动性浊音阳性', match: /移动性浊音阳性/ },
    { key: 'pev:abdomen.abdPercussion=肝区叩击痛', match: /肝区叩击痛/ },
    { key: 'pev:abdomen.abdPercussion=双肾区叩击痛', match: /肾区叩击痛/ },
    { key: 'pev:skin.color=皮肤黏膜苍白', match: /皮肤.*苍白|睑结膜苍白|贫血貌/ },
    { key: 'pev:skin.color=皮肤黏膜黄染', match: /黄染|黄疽/ },
    { key: 'pev:neck.thyroid=甲状腺可触及结节', match: /甲状腺.*结节/ },
    { key: 'pev:neck.thyroid=甲状腺Ⅰ度肿大', match: /甲状腺.*肿大/ },
    { key: 'pev:neurology.neuroExtra3=偏瘫', match: /偏瘫|偏侧.*无力/ },
    { key: 'pev:neurology.neuroExtra1=记忆力减退', match: /记忆力减退|记忆力下降/ },
    { key: 'pev:nervousPE.nerve=脑膜刺激征阳性', match: /颈抵抗|脑膜刺激征/ },
    { key: 'pev:general.face=满月面容', match: /满月脸/ },
    { key: 'pev:general.conscious=嗜睡', match: /嗜睡|昏睡/ },
    { key: 'pev:skin.rash=可见瘀点瘀斑', match: /瘀点|瘀斑|出血点/ },
  ];
  PEV_PATTERNS.forEach(pat => { if (pat.match.test(rawText)) findings.add(pat.key); });

  // age / gender
  if (p.age && Number(p.age) >= 60) findings.add('age:elderly');
  if (p.gender === '女') findings.add('gender:女');
  if (p.diagShort && p.diagShort.toLowerCase().indexOf('创伤') >= 0) findings.add('trauma:有');

  // 2. 按规则匹配
  // 科室映射 DEPT_MAP 已提升为全局常量（app.js 顶部），detectDisease 也会引用
  const deptKey = DEPT_MAP[p.diseaseKey] || 'general';
  const deptLabel = DEPT_LABEL[deptKey] || deptKey;

  const results = [];
  BINGLI_HINTS.forEach(rule => {
    // 康复科跨病种：本科室规则 + 标注 general 的通用兜底规则均纳入
    const inDept = rule.depts.includes(deptKey) || rule.depts.includes('general');
    if (!inDept) return;
    const matched = rule.match.filter(m => findings.has(m));
    if (matched.length < (rule.need || 2)) return;
    if (rule.must && rule.must.length && !rule.must.some(m => findings.has(m))) return;
    results.push({
      id: rule.id, name: rule.name, hint: rule.hint, note: rule.note,
      matched, need: rule.need || 2, score: matched.length / (rule.need || 2)
    });
  });
  results.sort((a, b) => b.score - a.score);

  // 3. 渲染
  if (!results.length) {
    return '<div class="blank" style="padding:30px 16px;text-align:center">' +
      '<div style="font-size:42px;margin-bottom:10px">🔍</div>' +
      '<div style="font-size:12px;color:var(--faint);line-height:1.7">' +
      '已扫描 ' + findings.size + ' 条发现点（症状/' + '既往史/' + '查体体征）<br>' +
      '当前 ' + deptLabel + ' 科室未触发诊断规则<br><br>' +
      '<span style="color:var(--brand);">可尝试：补充查体异常描述 / 完善既往史疾病 / 录入生命体征</span>' +
      '</div></div>';
  }
  const top = results.slice(0, 6);
  return '<div style="padding:10px">' +
    '<div style="font-size:11px;color:var(--muted);margin-bottom:8px">扫描 ' + findings.size + ' 条发现点 · ' + deptLabel + ' · 命中 ' + results.length + ' 条规则</div>' +
    top.map((r, i) =>
      '<div class="ddx-row" style="padding:10px 12px;margin-bottom:8px;border:1px solid ' + (i === 0 ? '#e7b86a' : '#eee') + ';border-radius:8px;background:' + (i === 0 ? '#fffbf2' : '#fff') + '">' +
        '<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:4px">' +
          '<span style="font-size:13px;font-weight:' + (i === 0 ? '700' : '600') + ';color:' + (i === 0 ? '#9a6515' : '#333') + '">🏥 ' + esc(r.name) + '</span>' +
          '<span style="font-size:10px;color:var(--faint)">匹配 ' + r.matched.length + '/' + r.need + ' · score ' + r.score.toFixed(1) + '</span>' +
        '</div>' +
        '<div style="font-size:11.5px;color:#555;line-height:1.6;margin-bottom:4px">💡 ' + esc(r.hint) + '</div>' +
        '<div style="font-size:10.5px;color:var(--faint);line-height:1.5">📋 ' + esc(r.note) + '</div>' +
        '<div style="font-size:10px;color:#888;margin-top:6px">' +
          r.matched.map(m => '<span style="background:#f2efe6;padding:1px 6px;border-radius:8px;margin-right:4px">' + esc(m) + '</span>').join('') +
        '</div>' +
      '</div>'
    ).join('') +
    (results.length > 6 ? '<div style="font-size:10px;color:var(--faint);text-align:center;margin-top:8px">还有 ' + (results.length - 6) + ' 条被折叠</div>' : '') +
    '</div>';
}

/* 把 bingli 模板的 alias 合并进 detectDisease 的关键词匹配 —— 更精准识别病种 */
function noteCardsHtml() {
  const q = state.noteQuery.trim().toLowerCase();
  const list = NOTE_BANK.filter((n) => (state.noteCat === '全部' || n.cat === state.noteCat) && (!q || n.text.toLowerCase().indexOf(q) >= 0));
  if (!list.length) return '<div class="blank">未找到匹配语句</div>';
  return list.map((n) => '<button class="note-card" data-note="' + NOTE_BANK.indexOf(n) + '"><span class="nc-cat">' + esc(n.cat) + '</span>' + esc(n.text) + '<span class="ins">＋</span></button>').join('');
}

function assistantNotes() {
  return '<div class="asst-search"><svg viewBox="0 0 24 24" class="ic"><circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/></svg>' +
    '<input id="noteSearch" type="search" placeholder="检索查房语句…" value="' + esc(state.noteQuery) + '"></div>' +
    '<div class="cat-row">' + ['全部'].concat(Array.from(new Set(NOTE_BANK.map((n) => n.cat)))).map((c) => '<button class="cat-chip' + (state.noteCat === c ? ' on' : '') + '" data-note-cat="' + c + '">' + c + '</button>').join('') + '</div>' +
    '<div class="asst-hint">点击语句插入病程草稿。当前收录 ' + NOTE_BANK.length + ' 条常用查房表述，可按科室习惯继续扩充。</div>' +
    '<div id="noteList">' + noteCardsHtml() + '</div>';
}

function assistantCompose(p) {
  const a = latest(p);
  const c = state.compose;
  return '<div class="asst-hint">先按查房要点快速选择，再回病程页微调，避免整段重写。</div>' +
    '<div class="gen-box"><h5>查房一句话生成</h5>' +
      '<div class="gen-row"><label>病种</label><select data-compose="cat">' + ['脑卒中', '骨科', '老年病', '神经康复', '认知康复', '疼痛康复', '血管康复'].map((x) => '<option' + (c.cat === x ? ' selected' : '') + '>' + x + '</option>').join('') + '</select></div>' +
      '<div class="gen-row"><label>精神与全身状态</label><select data-compose="mental">' + ['神志清，精神可', '神志清，精神一般', '精神平稳，情绪可', '精神稍弱，易疲劳'].map((o) => '<option' + (c.mental === o ? ' selected' : '') + '>' + o + '</option>').join('') + '</select></div>' +
      '<div class="gen-row"><label>主要改善点</label><select data-compose="strength">' + ['患肢肌力较前提升', '患肢肌力改善不明显', '患肢肌力稳步恢复', '四肢肌力正常，体能偏弱'].map((o) => '<option' + (c.strength === o ? ' selected' : '') + '>' + o + '</option>').join('') + '</select></div>' +
      '<div class="gen-row"><label>趋势判断</label><select data-compose="trend">' + ['较前改善', '病情平稳', '略有退步'].map((o) => '<option' + (c.trend === o ? ' selected' : '') + '>' + o + '</option>').join('') + '</select></div>' +
      '<div class="gen-row"><label>内科 / 卧床并发症要点</label>' + medGroupRows(c) + '</div>' +
      '<div class="gen-preview' + (state.draft ? '' : ' empty') + '" id="genPreview">' + (state.draft ? esc(state.draft) : '生成后显示在这里') + '</div>' +
      '<div style="display:flex;gap:6px"><button class="btn small outline" data-action="gen-draft" style="flex:1">生成</button>' +
      '<button class="btn small solid" data-action="use-draft" style="flex:1">写入病程</button></div>' +
    '</div>' +
    (a ? '<div class="asst-section"><div class="asst-label">本次评估摘要</div><div class="asst-hint" style="color:var(--ink-2)">' + esc(assessmentNarrative(p, a)) + '</div>' +
      '<button class="btn small outline" data-action="gen-draft-assess" style="width:100%">用评估数据生成病程</button></div>' : '');
}

function assistantQC() {
  const qc = computeQC();
  return '<div class="qc-summary"><div class="big-ring" style="--v:' + qc.score + '"><b>' + qc.score + '</b></div>' +
    '<div class="qcm"><b>病历完整度</b><span>' + qc.pass + ' / ' + qc.total + ' 项达标</span></div></div>' +
    '<div class="asst-hint">点「⚡ 一键补」自动填入模板 / 评估数据，已填的不覆盖。</div>' +
    '<div class="qc-list">' + qc.checks.map((c) => {
      if (!c.active) {
        return '<div class="qc-row pending" data-qc="' + c.tab + '" data-qc-sec="' + (c.sec || '') + '">' +
          '<span class="mark">·</span>' +
          '<span class="qtext">' + c.label + '<span class="qsub">' + c.sub + '（出院后考核）</span></span></div>';
      }
      return '<div class="qc-row ' + (c.pass ? 'ok' : 'fail') + '" data-qc="' + c.tab + '" data-qc-sec="' + (c.sec || '') + '">' +
      '<span class="mark">' + (c.pass ? '<svg viewBox="0 0 24 24" class="ic" style="width:9px;height:9px"><path d="m5 13 4 4L19 7"/></svg>' : '!') + '</span>' +
      '<span class="qtext">' + c.label + '<span class="qsub">' + c.sub + '</span>' +
      (c.pass ? '' : ' <button class="qc-auto" data-qc-fill="' + c.id + '" title="⚡ 一键补全">⚡</button>') +
      '</span></div>';
    }).join('') + '</div>' +
    (qc.pass < qc.total ? '<div style="margin-top:10px"><button class="btn small solid" data-action="auto-fill-all" style="width:100%">⚡ 全部一键补完（' + (qc.total - qc.pass) + ' 项）</button></div>' : '');
}

/* ---------------- 交互 ---------------- */
/* S2 辅助检查分格工具：按序连段 / 关键词归类 / 取映射格已有结果原文 */
function auxJoin(boxes) {
  boxes = boxes || {};
  return AUX_BOX_KEYS.map((k) => (boxes[k] || '').trim()).filter(Boolean).join('；');
}
function examPartsJoin(parts) {
  parts = parts || {};
  return EXAM_SECTION_KEYS.map((k) => (parts[k] || '').trim()).filter(Boolean).join('；');
}
function classifyAuxItem(text) {
  const q = normalizePhrase(text);
  if (!q) return 'other';
  for (const b of AUX_BOXES) {
    if (b.key === 'other') continue;
    if (b.keys.some((k) => q.indexOf(normalizePhrase(k)) >= 0)) return b.key;
  }
  return 'other';
}
function auxEvidenceFor(text, boxes) {
  const k = classifyAuxItem(text);
  const v = (boxes[k] || '').trim();
  if (!v) return null;
  const meta = AUX_BOXES.find((b) => b.key === k) || {};
  return { label: meta.label || k, text: v };
}

function setPath(obj, path, val) {
  const keys = path.split('.');
  let o = obj;
  for (let i = 0; i < keys.length - 1; i++) {
    if (o[keys[i]] == null) o[keys[i]] = {};
    o = o[keys[i]];
  }
  o[keys[keys.length - 1]] = val;
}
function getPath(obj, path) {
  return path.split('.').reduce((o, k) => (o == null ? o : o[k]), obj);
}

/* ---- 治疗项短语库：归一 / 匹配 / 批量导入（S4，K10 未命中清单） ---- */
function normalizePhrase(s) {
  return String(s == null ? '' : s).trim().replace(/[（）()【】\[\]、，,；;：:。.\s]/g, '').toLowerCase();
}
function matchPlanPhrase(raw) {
  const q = normalizePhrase(raw);
  if (!q) return null;
  const hit = PLAN_PHRASES.find((x) => normalizePhrase(x.full) === q)
    || PLAN_PHRASES.find((x) => (x.aliases || []).some((a) => normalizePhrase(a) === q));
  return hit ? hit.full : null;
}
/* 把全称并入现有方案文本（去重、去掉结尾标点后连接） */
function appendToPlan(cur, full) {
  return cur.trim() ? cur.trim().replace(/[。；;]+\s*$/, '') + '、' + full : full;
}
/* 方案文本按顿号 / 逗号 / 分号拆为独立段，避免长描述句里的子串被误判为已选 */
function planSegments(cur) {
  return String(cur || '').split(/[、，,；;]/).map((s) => s.trim()).filter(Boolean);
}
function planHasPhrase(cur, full) {
  const f = normalizePhrase(full);
  return planSegments(cur).some((s) => normalizePhrase(s) === f);
}
function togglePlanPhrase(full) {
  const p = P(); if (!p) return;
  let cur = p.record.plan || '';
  if (planHasPhrase(cur, full)) {
    cur = planSegments(cur).filter((s) => normalizePhrase(s) !== normalizePhrase(full)).join('、');
  } else {
    cur = appendToPlan(cur, full);
  }
  p.record.plan = cur; scheduleSave(); renderView();
}
function importPlanPhrases(text) {
  const p = P(); if (!p) return { added: [], missed: [] };
  const parts = String(text || '').split(/[、,，;；\n\r]+/).map((s) => s.trim()).filter(Boolean);
  const cur = p.record.plan || '';
  const existing = new Set(PLAN_PHRASES.map((x) => x.full).filter((f) => planHasPhrase(cur, f)));
  const added = [], missed = [];
  parts.forEach((raw) => {
    const full = matchPlanPhrase(raw);
    if (full) { if (!existing.has(full)) { existing.add(full); added.push(full); } }
    else missed.push(raw);
  });
  if (added.length) p.record.plan = added.reduce((acc, f) => appendToPlan(acc, f), cur);
  scheduleSave();
  return { added, missed };
}

/* 预览内联编辑：失焦后回写到对应字段 */
function commitInlineEdit(el) {
  const p = P();
  const path = el.dataset.edit;
  const val = el.innerText.replace(/ /g, ' ').trim();
  setPath(p, path, val);
  scheduleSave();
  renderAll();
  toast('已保存到对应字段');
}

/* 粘贴病例文本 → 规则抽取回填；只填空字段，已填不覆盖。返回本次填入项标签列表。 */
function parseAndFill(p, text) {
  const r = p.record;
  const filled = [];
  // "空 / 只有模板占位（含 __ 的示例文字）"才写入；医生真填过的内容仍然不动
  const isPlaceholderText = (v) => v == null || !String(v).trim() || /__/.test(String(v));
  const setIfEmpty = (path, value, label) => {
    const cur = getPath(p, path);
    if (!isPlaceholderText(cur)) return;
    if (value == null || String(value).trim() === '') return;
    setPath(p, path, String(value).trim());
    filled.push(label);
  };
  const grab = (re, src) => { const m = (src || text).match(re); return m ? m[1] : null; };
  // 通用章节停止标签：抓到下一章节标题前为止，支持多行编号列表
  const STOP_RE = /(?:诊断依据|鉴别诊断|鉴别|诊疗计划|治疗计划|处置|医嘱|出院情况|出院诊断|初步诊断|入院诊断|临床诊断|现病史|既往史|个人史|家族史|过敏史|辅助检查|查体|专科检查|专科查体)/;
  const sectionBlock = (labelRe, stopRe) => {
    const m = text.match(labelRe);
    if (!m) return null;
    const rest = text.slice(m.index + m[0].length);
    const stop = rest.search(stopRe || STOP_RE);
    return (stop >= 0 ? rest.slice(0, stop) : rest).trim();
  };
  const sectionAfter = (labelRe) => { const m = text.match(labelRe); return m ? (m[1] || '').trim() : null; };
  // 诊断条目拆分：按换行 + 编号（1. / 1、 / 1．）前瞻切段，兼容同行连续编号；后顾断言避免把 10、11 等多位数内部切断
  const splitDiagItems = (block) => {
    const out = [];
    const numRe = /(?=(?<!\d)\d+\s*[.、．])/;
    String(block || '').split(/\n/).forEach((line) => {
      line.split(numRe).forEach((s) => {
        const d = s.replace(/^\s*(?<!\d)\d+\s*[.、．]\s*/, '').replace(/[。；;，,、]\s*$/, '').trim();
        if (d) out.push(d);
      });
    });
    return out;
  };

  // 姓名：仅在“患者”后紧跟姓名 + 性别/年龄/逗号时提取，避开“患者家属/患者及”
  const name = grab(/患者\s*([一-龥]{2,4})\s*(?:，|,|男|女|岁|老年)/);
  setIfEmpty('name', name, '姓名');

  if (/女/.test(text) && !/男/.test(text)) setIfEmpty('gender', '女', '性别');
  else if (/男/.test(text) && !/女/.test(text)) setIfEmpty('gender', '男', '性别');

  const age = grab(/(\d{1,3})\s*岁/); if (age) setIfEmpty('age', Number(age), '年龄');

  // 患侧：只统计肢体无力/偏瘫语境；解剖双侧（瞳孔/脑室/耳廓等）与健侧肌力 5 级不计入
  const weakLeft = /左(?:侧)?(?:肢体|上肢|下肢)?(?:活动不利|活动不灵|无力|偏瘫|瘫痪)/.test(text) || /伸舌偏左|左侧鼻唇沟变浅/.test(text);
  const weakRight = /右(?:侧)?(?:肢体|上肢|下肢)?(?:活动不利|活动不灵|无力|偏瘫|瘫痪)/.test(text) || /伸舌偏右|右侧鼻唇沟变浅/.test(text);
  const bothWeak = /四肢瘫|四肢瘫痪|双侧肢体活动不利|双侧肢体活动不灵|双瘫/.test(text);
  let side = '';
  if (bothWeak) side = '双侧';
  else if (weakLeft && weakRight) side = '双侧';
  else if (weakLeft) side = '左';
  else if (weakRight) side = '右';
  if (side) setIfEmpty('side', side, '患侧');

  // 查体段：生命体征优先取查体段同行，避免命中既往史/病程里的既往数值
  const examSeg = sectionBlock(/查体[：:]/, /(?:专科检查|专科查体|辅助检查|鉴别诊断|诊断依据)/);
  const bp = grab(/(?:BP|血压)\s*[:：]?\s*(\d{2,3}\s*\/\s*\d{2,3})/i, examSeg)
          || grab(/(?:BP|血压)\s*[:：]?\s*(\d{2,3}\s*\/\s*\d{2,3})/i);
  if (bp) setIfEmpty('record.vitals.bp', bp.replace(/\s/g, ''), '血压');
  const t = grab(/(?:T|体温)\s*[:：]?\s*(\d{2}(?:\.\d)?)/i, examSeg) || grab(/(?:T|体温)\s*[:：]?\s*(\d{2}(?:\.\d)?)/i);
  if (t) setIfEmpty('record.vitals.t', t, '体温');
  const pr = grab(/(?:P|脉搏|脉率)\s*[:：]?\s*(\d{2,3})/i, examSeg) || grab(/(?:P|脉搏|脉率)\s*[:：]?\s*(\d{2,3})/i);
  if (pr) setIfEmpty('record.vitals.p', pr, '脉搏');
  const rr = grab(/(?:R|呼吸)\s*[:：]?\s*(\d{2,3})\s*次/i, examSeg) || grab(/(?:R|呼吸)\s*[:：]?\s*(\d{2,3})\s*次/i);
  if (rr) setIfEmpty('record.vitals.r', rr, '呼吸');
  const so2 = grab(/(?:SpO2|血氧|饱和度)\s*[:：]?\s*(\d{2,3})/i); if (so2) setIfEmpty('record.vitals.spo2', so2, '血氧');

  // 主诉：先找独立标签；无标签时从句式“主因…为主诉入院”兜底
  let chief = sectionAfter(/(?:主\s*诉|主诉)[：:]\s*([^\n\r。；;]+)/);
  if (!chief) chief = grab(/主因\s*([^，,。；;]+?)\s*为主诉/);
  if (!chief) chief = grab(/以\s*([^，,。；;]+?)\s*为主诉入院/);
  // 现病史停止标签按行首匹配：避免把句中叙述的“临床诊断/初步诊断”等字样误判为章节标题而截断现病史
  const presentStopRe = /(?:^|\n)\s*(?:\d+\s*[、.．])?\s*(?:诊断依据|鉴别诊断|诊疗计划|治疗计划|处置|医嘱|出院情况|出院诊断|初步诊断|入院诊断|临床确定诊断|确定诊断|临床诊断|既往史|个人史|家族史|过敏史|辅助检查|影像检查|化验检查|医技检查|专科检查|专科查体|查体)[：:]/;
  const present = sectionBlock(/(?:现\s*病\s*史|现病史)[：:]/, presentStopRe);
  let past = sectionAfter(/(?:既\s*往\s*史|既往史)[：:]\s*([^\n\r。；;]+)/);
  if (!past) {
    // 既往史常夹在现病史段句首（"…为主诉入院。既往发现高血压病史2年余…"），
    // 因此不再局限于"现病史"标签之前的抬头，直接在全文里找既往叙述，取最靠前的两三条
    const pm1 = text.match(/既往[^\n。；;]*(?:病史|高血压|血栓|低钾|骨质疏松|糖尿病|冠心病)[^\n。；;]*/g) || [];
    const pm2 = text.match(/有[^\n。；;]*(?:血栓|低钾|骨质疏松|糖尿病|冠心病|病史)[^\n。；;]*/g) || [];
    const pm = [];
    [...pm1, ...pm2].forEach((s) => {
      const norm = s.replace(/^既往/, '').trim();
      const dup = pm.some((x) => x.norm === norm || x.norm.indexOf(norm) >= 0 || norm.indexOf(x.norm) >= 0);
      if (!dup) pm.push({ s: s.trim(), norm });
    });
    past = pm.length ? pm.slice(0, 2).map((x) => x.s).join('；') : null;
  }
  const personal = sectionAfter(/(?:个\s*人\s*史|个人史)[：:]\s*([^\n\r]+)/);
  const family = sectionAfter(/(?:家\s*族\s*史|家族史)[：:]\s*([^\n\r]+)/);
  const allergy = sectionAfter(/(?:过\s*敏\s*史|过敏史|药物过敏)[：:]\s*([^\n\r]+)/);
  const aux = sectionBlock(/(?:辅\s*助\s*检\s*查|辅助检查|影像检查|化验检查|医技检查)[：:]/);
  setIfEmpty('record.chief', chief, '主诉');
  setIfEmpty('record.present', present, '现病史');
  setIfEmpty('record.past', past, '既往史');
  setIfEmpty('record.personal', personal, '个人史');
  setIfEmpty('record.family', family, '家族史');
  setIfEmpty('record.allergy', allergy, '过敏史');
  setIfEmpty('record.aux', aux, '辅助检查');
  // 一般查体：剥离开头生命体征行后兜底写入一般查体段；专科查体段单独落 record.neuro。均仅填空、不覆盖已有内容。
  let examGeneral = examSeg ? examSeg.replace(/^\s*(?:T|体温)\s*[:：]?\s*\d{2}(?:\.\d)?℃?[^。]*。/, '').trim() : '';
  if (examGeneral) setIfEmpty('record.examParts.general', examGeneral, '一般查体');
  const neuroSeg = sectionBlock(/(?:专科检查|专科查体)[：:]/, /(?:辅助检查|鉴别诊断|诊断依据|诊疗计划|治疗计划|处置|医嘱)/);
  if (neuroSeg) setIfEmpty('record.neuro', neuroSeg, '专科查体');
  if (p.record.examParts) p.record.exam = examPartsJoin(p.record.examParts);
  if (aux && aux.trim() && !auxJoin(p.record.auxBoxes)) {
    p.record.auxBoxes = p.record.auxBoxes || {};
    // 保序回填：整段按原文条目顺序并入兜底格，不按类别切碎重排
    p.record.auxBoxes.other = aux.split(/[；;。\n]/).map((s) => s.trim()).filter(Boolean).join('；');
    p.record.aux = auxJoin(p.record.auxBoxes);
  }

  // 诊断：覆盖初步/入院/临床确定诊断等多个标签块，跨编号行全部入列并去重
  const diagBlocks = [
    /(?:入院诊断|初步诊断)[：:]/,
    /(?:临床确定诊断|确定诊断|临床诊断)[：:]/
  ].map((re) => sectionBlock(re, /(?:诊断依据|鉴别诊断|诊疗计划|治疗计划|处置|医嘱|本病需与)/));
  diagBlocks.filter(Boolean).forEach((blk) => {
    splitDiagItems(blk).forEach((d) => {
      if (!r.diagnoses.includes(d)) { r.diagnoses.push(d); filled.push('诊断'); }
    });
  });

  {
    const keyText = (chief || '') + ' ' + (present || '');
    const key = detectDisease(keyText);
    const nameOf = (k) => (DISEASE_KEYWORDS.find((x) => x.key === k) || {}).name;
    let name = nameOf(key);
    // 脑卒中大类下按瘫痪形态调整括号措辞：四肢瘫 / 双瘫 / 偏瘫
    if (key === 'stroke' && name) {
      if (bothWeak) name = '脑卒中（四肢瘫）';
      else if (side === '双侧') name = '脑卒中（双瘫）';
    }
    const dsNow = (p.diagShort || '').trim();
    const oldName = nameOf(p.diseaseKey);
    // 只有"没填 / 待明确 / 仍是上一个模板的病种名"时才替换；医生自己填的主要诊断不动
    const looksPlaceholder = !dsNow || dsNow === '待明确' || (oldName && dsNow === oldName);
    if (name && looksPlaceholder && name !== dsNow) {
      if (oldName && dsNow === oldName) {
        const di = p.record.diagnoses.findIndex((d) => d === oldName);
        if (di >= 0) p.record.diagnoses.splice(di, 1);
      }
      p.diagShort = name;
      filled.push('主要诊断(简)');
    }
  }
  return filled;
}

// 日期录入软提示：不硬阻断，仅在未来日期 / 出院早于入院时提醒核对；返回空串表示无问题
function dateWarn(path, val, p) {
  const v = normDate(val);
  const today = todayISO();
  if (path === 'admitDate') {
    if (v && dateTs(v) > dateTs(today)) return '入院日期晚于今天，请核对';
  } else if (path === 'discharge.date') {
    if (v && p.admitDate && dateTs(v) < dateTs(p.admitDate)) return '出院日期早于入院日期，请核对';
    if (v && dateTs(v) > dateTs(today)) return '出院日期晚于今天，请核对';
  }
  return '';
}

function handleBind(el) {
  const p = P();
  if (!p) return;
  const path = el.dataset.bind;
  let val = el.type === 'number' ? (el.value === '' ? '' : Number(el.value)) : el.value;
  const datePath = (path === 'admitDate' || path === 'discharge.date');
  if (datePath) val = normDate(val);
  if (path.indexOf('record.') === 0 || path.indexOf('discharge.') === 0) setPath(p, path, val);
  else if (path === 'age') p.age = el.value === '' ? '' : asNum(val, 0);
  else p[path] = val;
  if (datePath) { const w = dateWarn(path, val, p); if (w) toast(w); }
  if (path.indexOf('record.auxBoxes.') === 0) p.record.aux = auxJoin(p.record.auxBoxes);
  if (path === 'record.aux') {
    p.record.auxBoxes = p.record.auxBoxes || {};
    const boxed = auxJoin(p.record.auxBoxes).trim();
    const txt = String(p.record.aux || '').trim();
    // 分格已有内容时，整段文本不再"清空重排"（否则改一句会把别的格全打乱）：
    // 只有分格还空着才回填，且整段放进「其他」，不按句号切碎
    if (!boxed && txt) p.record.auxBoxes.other = txt;
    p.record.aux = auxJoin(p.record.auxBoxes);
  }
  if (path.indexOf('record.examParts.') === 0) p.record.exam = examPartsJoin(p.record.examParts);
  if (path === 'record.exam') {
    p.record.examParts = p.record.examParts || {};
    const parted = examPartsJoin(p.record.examParts).trim();
    const txt = String(p.record.exam || '').trim();
    // 同上：不清空已分好的查体分节，只在分节全空时把整段放进「一般情况」
    if (!parted && txt) p.record.examParts.general = txt;
    p.record.exam = examPartsJoin(p.record.examParts);
  }
  scheduleSave();
  const identity = ['name', 'bed', 'mrn', 'status', 'diagShort', 'admitDate', 'side', 'gender', 'age'];
  if (identity.indexOf(path) >= 0) { renderRail(); renderSwitch(); renderHead(); }
  else if (path === 'discharge.date') { renderView(); renderHead(); }
  else if (path.indexOf('record.') !== 0) { renderHead(); }
  renderTabs();
  if (state.atab === 'qc') renderAssistant();
}

/* 量表"本次是否真录入过"：未动过的量表不显示 0 分、也不写进打印稿，
   否则未评定会被当成"0 分 / 完全依赖"打进病历。旧档案没有标记位时按已评定处理。 */
function isTouched(a, key) {
  if (!a) return false;
  if (!isObj(a.touched)) return true;
  return !!a.touched[key];
}
function markTouch(a, key) {
  if (!a) return;
  if (!isObj(a.touched)) a.touched = {};
  a.touched[key] = true;
}
/* 评估小结文字：只列真正录过的量表 */
function assessSummary(a) {
  if (!a) return '—';
  const out = [];
  if (isTouched(a, 'barthel')) { const b = barthelTotal(a); out.push('Barthel ' + b + ' 分（' + barthelGrade(b).label + '）'); }
  if (isTouched(a, 'berg')) { const bg = bergTotal(a); out.push('Berg ' + bg + ' 分（' + bergGrade(bg).label + '）'); }
  if (isTouched(a, 'mmse')) out.push('MMSE ' + mmseTotal(a) + ' 分');
  if (isTouched(a, 'kouda')) out.push('洼田饮水试验 ' + a.kouda + ' 级');
  if (isTouched(a, 'holden')) out.push('Holden ' + a.holden + ' 级');
  if (isTouched(a, 'vas')) out.push('VAS ' + a.vas + ' 分');
  state.customScales.filter((d) => hasCustomValue(a, d)).forEach((d) => {
    const v = scaleTotal(a, d), g = scaleGrade(d, v);
    out.push(esc(d.title) + ' ' + v + (d.max ? '/' + d.max + ' 分' : ' 分') + (g.label ? '（' + esc(g.label) + '）' : ''));
  });
  return out.length ? out.join('；') + '。' : '本次评定未录入量表分。';
}

function handleAssess(el) {
  const p = P();
  if (!p) return;
  const a = latest(p);
  if (!a) return;
  const path = el.dataset.assess;
  const keys = path.split('.');
  let val = el.value;
  if (keys[0] === 'mmt') {
    if (!a.mmt[keys[1]]) a.mmt[keys[1]] = ['', ''];
    a.mmt[keys[1]][Number(keys[2])] = Number(val);
  } else if (keys[0] === 'mas') {
    if (!a.mas[keys[1]]) a.mas[keys[1]] = ['0', '0'];
    a.mas[keys[1]][Number(keys[2])] = val;
  } else if (keys[0] === 'brunnstrom') a.brunnstrom[keys[1]] = val;
  else if (keys[0] === 'barthel') a.barthel[keys[1]] = Number(val);
  else if (keys[0] === 'mmse') {
    const item = MMSE_ITEMS.find((x) => x.key === keys[1]);
    a.mmse[keys[1]] = clamp(val, 0, item ? item.max : 30);
  }
  else if (keys[0] === 'kouda') a.kouda = Number(val);
  else if (keys[0] === 'holden') a.holden = Number(val);
  else if (keys[0] === 'custom') {
    const def = scaleById(keys[1]);
    if (!def) return;
    if (!isObj(a.custom)) a.custom = {};
    if (!isObj(a.custom[def.id])) a.custom[def.id] = {};
    const bag = a.custom[def.id];
    if (def.kind === 'single-select' || def.kind === 'slider') bag.value = Number(val) || 0;
    else if (def.kind === 'side-grid-select') {
      if (!Array.isArray(bag[keys[2]])) bag[keys[2]] = ['', ''];
      bag[keys[2]][Number(keys[3])] = val;
    } else bag[keys[2]] = Number(val) || 0;
  }
  const TOUCH_MAP = { mmt: 'mmt', mas: 'mas', brunnstrom: 'brunnstrom', barthel: 'barthel', mmse: 'mmse', kouda: 'kouda', holden: 'holden' };
  if (TOUCH_MAP[keys[0]]) markTouch(a, TOUCH_MAP[keys[0]]);
  scheduleSave();
  // renderView 内部会先记住焦点、渲染完再放回去，连续录量表不会被打断
  renderView();
  renderHead();
  renderTabs();
}

document.addEventListener('click', (e) => {
  const vm = e.target.closest('[data-vmode]');
  if (vm) { state.viewMode = vm.dataset.vmode; renderView(); $$('#viewMode .vm-btn').forEach((b) => b.classList.toggle('active', b.dataset.vmode === state.viewMode)); return; }
  const pvSec = e.target.closest('.preview-body h2[data-sec]');
  if (pvSec && pvSec.dataset.sec !== 'report') { jumpToSec(pvSec.dataset.sec); return; }
  const secToggle = e.target.closest('[data-sec-toggle]');
  if (secToggle) {
    const k = secToggle.dataset.secToggle;
    state.collapsedSec[k] = !state.collapsedSec[k];
    renderView();
    return;
  }
  const navSec = e.target.closest('[data-nav-sec]');
  if (navSec) { scrollToSec(navSec.dataset.navSec); return; }
  const scaleToggle = e.target.closest('[data-scale-toggle]');
  if (scaleToggle) {
    const k = scaleToggle.dataset.scaleToggle;
    state.collapsedScale[k] = !state.collapsedScale[k];
    renderView();
    return;
  }
  const patDel = e.target.closest('[data-del-patient]');
  if (patDel) { e.stopPropagation(); askDeletePatient(patDel.dataset.delPatient); return; }
  const pat = e.target.closest('[data-patient]');
  if (pat) {
    selectPatient(pat.dataset.patient);
    return;
  }
  const chipF = e.target.closest('[data-filter]');
  if (chipF) {
    state.filter = chipF.dataset.filter;
    $$('#statusFilters .chip').forEach((c) => c.classList.toggle('active', c === chipF));
    renderRail();
    return;
  }
  const tab = e.target.closest('[data-tab]');
  if (tab) { state.tab = tab.dataset.tab; renderTabs(); renderView(false); renderAssistant(); return; }
  const st = e.target.closest('[data-subtab]');
  if (st) { state.assessTab = st.dataset.subtab; renderView(false); return; }
  const spick = e.target.closest('[data-spick]');
  if (spick) {
    const pkTab = spick.dataset.spickTab || state.assessTab;
    const pk = scalePickOf(pkTab);
    const key = spick.dataset.spick;
    if (pk[key]) delete pk[key];
    else { pk[key] = true; state.collapsedScale[key] = false; }
    const box0 = $('#assessBody');
    const p0 = P(); const a0 = p0 && latest(p0);
    if (box0) box0.innerHTML = assessBodyHtml(p0, a0); else renderView(false);
    return;
  }
  const catOpen = e.target.closest('[data-cat-open]');
  if (catOpen) { openScaleByName(catOpen.dataset.catOpen); return; }
  const spMore = e.target.closest('[data-spick-more]');
  if (spMore) {
    if (!isObj(state.pkMore)) state.pkMore = {};
    const mt = spMore.dataset.spickMore;
    state.pkMore[mt] = !state.pkMore[mt];
    const bx = $('#assessBody'); const pm = P(); const am = pm && latest(pm);
    if (bx) bx.innerHTML = assessBodyHtml(pm, am); else renderView(false);
    return;
  }
  if (e.target.closest('[data-spick-clear]')) {
    state.scalePick[state.assessTab] = {};
    const box1 = $('#assessBody');
    const p1 = P(); const a1 = p1 && latest(p1);
    if (box1) box1.innerHTML = assessBodyHtml(p1, a1); else renderView(false);
    return;
  }
  const af = e.target.closest('[data-afilter]');
  if (af) { state.assessFilter = af.dataset.afilter; state.knOpen = null; renderView(false); return; }
  const knT = e.target.closest('[data-kn-toggle]');
  if (knT) { state.knOpen = !knOpenNow(); renderView(); return; }
  const at = e.target.closest('[data-atab]');
  if (at) { state.atab = at.dataset.atab; renderAssistant(); return; }
  const berg = e.target.closest('[data-berg]');
  if (berg) {
    const p = P(); const a = p && latest(p);
    if (!a || !Array.isArray(a.berg)) return;
    const i = Number(berg.dataset.berg);
    if (i < 0 || i >= a.berg.length) return;
    a.berg[i] = Number(berg.dataset.val);
    markTouch(a, 'berg');
    scheduleSave(); renderView(); renderHead();
    return;
  }
  const cbtn = e.target.closest('[data-cbtn]');
  if (cbtn) {
    const p = P(); const a = p && latest(p);
    const def = a && scaleById(cbtn.dataset.cbtn);
    if (!a || !def) return;
    if (!isObj(a.custom)) a.custom = {};
    if (!isObj(a.custom[def.id])) a.custom[def.id] = {};
    a.custom[def.id][cbtn.dataset.ckey] = Number(cbtn.dataset.val);
    markTouch(a, 'custom:' + def.id);
    scheduleSave(); renderView(); renderHead();
    return;
  }
  const catAdd = e.target.closest('[data-cat-add]');
  if (catAdd) { addCatalogScale(catAdd.dataset.catAdd); return; }
  const med = e.target.closest('[data-med]');
  if (med) {
    const c = state.compose;
    if (!Array.isArray(c.med)) c.med = [];
    const v = med.dataset.med;
    const i = c.med.indexOf(v);
    if (i >= 0) c.med.splice(i, 1); else c.med.push(v);
    renderView(); renderAssistant();
    return;
  }
  const pick = e.target.closest('[data-pick]');
  if (pick) {
    const c = state.compose;
    const v = pick.dataset.pick;
    const i = c.items.indexOf(v);
    if (i >= 0) c.items.splice(i, 1); else c.items.push(v);
    renderView(); renderAssistant();
    return;
  }
  const phrase = e.target.closest('[data-plan-phrase]');
  if (phrase) { togglePlanPhrase(phrase.dataset.planPhrase); return; }
  const tpl = e.target.closest('[data-tpl]');
  if (tpl) {
    const p = P(), key = tpl.dataset.tpl, t = DISCHARGE_TEMPLATES[key];
    p.discharge.templateKey = key;
    p.discharge.advice = t.items.slice();
    p.discharge.checked = t.items.map((_, i) => i);
    scheduleSave(); renderView(); renderAssistant();
    toast('已套用「' + t.name + '」共 ' + t.items.length + ' 条');
    return;
  }
  const nc = e.target.closest('[data-note-cat]');
  if (nc) { state.noteCat = nc.dataset.noteCat; renderAssistant(); return; }
  const note = e.target.closest('[data-note]');
  if (note) {
    const item = NOTE_BANK[Number(note.dataset.note)];
    state.draft = (state.draft ? state.draft.replace(/\s+$/, '') + ' ' : '') + item.text;
    state.tab = 'course';
    renderAll();
    toast('已加入病程草稿');
    goDraft();
    return;
  }
  const qcAutoFill = e.target.closest('[data-qc-fill]');
  if (qcAutoFill) {
    e.stopPropagation();
    const p = P();
    const a = latest(p);
    const id = qcAutoFill.dataset.qcFill;
    refreshDiseaseKey(p);
    const T = ADMIT_TEMPLATES[p.diseaseKey];
    const D = DIFF_DX[p.diseaseKey];
    let msg = '';
    switch (id) {
      case 'chief': if (!p.record.chief && T) { p.record.chief = T.chief; msg = '主诉已从模板填充'; } break;
      case 'present': if (!p.record.present && T) { p.record.present = T.present; msg = '现病史已从模板填充'; } break;
      case 'past': if (!p.record.past && T) { p.record.past = T.past; msg = '既往史已从模板填充'; } break;
      case 'vitals': if (!p.record.vitals.bp && T) { p.record.vitals = clone(T.vitals); msg = '生命体征已从模板填充'; } break;
      case 'neuro': if (!p.record.neuro) { if (a) { p.record.neuro = assessmentNarrative(p, a); msg = '专科查体已由评估摘要生成'; } else if (T) { p.record.neuro = T.neuro; msg = '专科查体已从模板填充'; } } break;
      case 'diag': if (!p.record.diagnoses.length && T) { p.record.diagnoses = T.diagnoses.slice(); msg = '初步诊断已从模板填充'; } break;
      case 'assess': msg = '康复评估需临床亲自评定，系统无法替你打分'; break;
      case 'goal': {
        if (a) {
          const g = deriveGoals(p, a);
          if (!p.record.goalsShort && g.short) p.record.goalsShort = g.short;
          if (!p.record.goalsLong && g.long) p.record.goalsLong = g.long;
          msg = '康复目标已由评估数据生成';
        } else if (T) {
          if (!p.record.goalsShort) p.record.goalsShort = T.goalsShort;
          if (!p.record.goalsLong) p.record.goalsLong = T.goalsLong;
          msg = '康复目标已从模板填充';
        }
        break;
      }
      case 'notes': msg = '病程记录需查房后书写，系统已在病程页提供日程模板卡片'; break;
      case 'ddx': if ((p.record.diffDx.items || []).length < 3 && D) { p.record.diffDx = { key: p.diseaseKey, items: ddxFromDict(p.diseaseKey) }; msg = '鉴别诊断已按病种重新生成'; } break;
      case 'discharge': {
        const tplKey = DISEASE_TO_DISCHARGE_TPL[p.diseaseKey] || 'general';
        const tpl = DISCHARGE_TEMPLATES[tplKey];
        if (!p.discharge.advice.length && tpl) { p.discharge.advice = tpl.items.slice(); p.discharge.checked = tpl.items.map((_, i) => i); p.discharge.templateKey = tplKey; msg = '出院医嘱已按病种模板填充（' + tpl.name + '）'; }
        break;
      }
      case 'dSummary': if (!(p.discharge.summary || '').trim()) { p.discharge.summary = buildDischargeSummary(p); msg = '出院小结已由病历与评估生成'; } break;
      case 'followUp': if (!(p.discharge.followUp || '').trim()) { p.discharge.followUp = FOLLOW_UP_OPTIONS[0]; msg = '已安排默认复诊建议'; } break;
      case 'plan': if (!p.record.plan) { if (a) { p.record.plan = derivePlan(p, a); msg = '治疗方案已由评估数据生成'; } else if (T) { p.record.plan = T.plan; msg = '治疗方案已从模板填充'; } } break;
    }
    if (msg) toast('⚡ ' + msg);
    scheduleSave(); renderAll();
    return;
  }
  const qcJump = e.target.closest('[data-qc]');
  if (qcJump) {
    state.tab = qcJump.dataset.qc;
    renderTabs(); renderView(false); renderAssistant();
    const sec = qcJump.dataset.qcSec;
    if (sec) setTimeout(() => scrollToSec(sec), 60);
    return;
  }
  const sched = e.target.closest('[data-sched]');
  if (sched) {
    // 仅填入草稿：模板含 __ 占位，必须由医师补全并核对后再手动保存，不能直接归档
    const day = sched.dataset.schedDay || '';
    const text = sched.dataset.schedText || '';
    if (!text) return;
    state.draft = (state.draft ? state.draft.replace(/\s+$/, '') + '\n' : '') + text;
    state.tab = 'course';
    renderAll();
    toast((day ? '「' + day + '」' : '日程模板') + '已填入草稿，请补全 __ 处后再保存');
    goDraft();
    return;
  }
  const voice = e.target.closest('[data-voice]');
  if (voice) {
    const target = $('[data-bind="' + voice.dataset.target + '"]');
    if (target) startVoice(target);
    return;
  }

  /* ---------- ROS 症状点击循环切换 ---------- */
  const rosSym = e.target.closest('[data-ros-sym]');
  if (rosSym) {
    const p = P();
    const path = rosSym.dataset.rosSym; // 如 "resp.cough"
    const [sysKey, symKey] = path.split('.');
    if (!p.record.ros[sysKey]) p.record.ros[sysKey] = {};
    const cur = p.record.ros[sysKey][symKey] || {};
    if (cur.checked) {
      // 阳性 → 阴性
      p.record.ros[sysKey][symKey] = { negative: true };
    } else if (cur.negative) {
      // 阴性 → 清除
      delete p.record.ros[sysKey][symKey];
      if (!Object.keys(p.record.ros[sysKey]).length) delete p.record.ros[sysKey];
    } else {
      // 未关注 → 阳性
      p.record.ros[sysKey][symKey] = { checked: true };
    }
    scheduleSave(); renderView(); return;
  }

  /* ---------- ROS 系统折叠 ---------- */
  const rosTog = e.target.closest('[data-ros-toggle]');
  if (rosTog) {
    const body = document.querySelector('[data-ros-body="' + rosTog.dataset.rosToggle + '"]');
    if (body) body.classList.toggle('collapsed');
    const arrow = rosTog.querySelector('.ros-arrow');
    if (arrow) arrow.textContent = body.classList.contains('collapsed') ? '▶' : '▼';
    return;
  }

  const btn = e.target.closest('[data-action]');
  if (!btn) return;
  const act = btn.dataset.action;
  const p = P();
  // 空患者态下只放行与患者无关的动作，其余提示先建患者，避免各分支读到 undefined 崩掉
  if (!p) {
    const pFree = ['new-patient', 'save-patient', 'close-modal', 'export-backup', 'data-manage',
      'import-backup', 'probe-backup', 'clear-demo', 'dismiss-demo', 'confirm-clear-demo',
      'ask-del-patient', 'confirm-del-patient', 'toggle-assistant', 'open-sources', 'scale-manage', 'open-scale-form'];
    if (pFree.indexOf(act) < 0) { toast('还没有患者，请先点「新建患者」'); return; }
  }

  switch (act) {
    case 'parse-paste': {
      const input = $('#parseInput');
      const text = (input ? input.value : '').trim();
      if (!text) { toast('请先粘贴病例文字'); break; }
      state.parseDraft = text;
      const filled = parseAndFill(p, text);
      refreshDiseaseKey(p);
      scheduleSave();
      renderAll();
      toast(filled.length ? '已回填：' + filled.join('、') : '未识别到可填入的字段，可手动补充');
      break;
    }
    case 'report-parse': {
      const input = $('#reportInput');
      const text = (input ? input.value : '').trim();
      state.reportDraft = text;
      state.reportParsed = parseReport(text, p ? p.gender : '');
      renderView();
      toast(state.reportParsed.length ? '已识别 ' + state.reportParsed.length + ' 项指标' : '未识别到字典内指标，可人工核对原文');
      break;
    }
    case 'report-clear': {
      state.reportDraft = ''; state.reportParsed = []; renderView(); break;
    }
    case 'report-to-aux': {
      if (!state.reportParsed.length) { toast('暂无可写入的指标'); break; }
      const summ = state.reportParsed.map((x) => x.name + ' ' + x.val + (x.unit ? ' ' + x.unit : '') + '（参考 ' + x.ref + '，' + reportDirLabel(x.dir) + '）').join('；');
      p.record.auxBoxes = p.record.auxBoxes || {};
      p.record.auxBoxes.lab = (p.record.auxBoxes.lab || '').trim();
      p.record.auxBoxes.lab = p.record.auxBoxes.lab ? p.record.auxBoxes.lab + '；' + summ : summ;
      p.record.aux = auxJoin(p.record.auxBoxes);
      scheduleSave(); renderAll(); renderHead();
      toast('指标摘要已写入辅助检查');
      break;
    }
    case 'report-copy': {
      if (!state.reportParsed.length) { toast('暂无可复制的解读稿'); break; }
      const txt = state.reportParsed.map((x) => x.name + ' ' + x.val + (x.unit ? ' ' + x.unit : '') + '（参考 ' + x.ref + '，' + reportDirLabel(x.dir) + '）：' + x.note).join('\n');
      navigator.clipboard && navigator.clipboard.writeText(txt).catch(() => {});
      toast('解读稿已复制到剪贴板');
      break;
    }
    case 'report-word': { exportReportWord(); break; }
    case 'report-to-summary': {
      if (!state.reportParsed.length) { toast('暂无可并入的指标'); break; }
      const abn = state.reportParsed.filter((x) => x.dir !== 'ok');
      const okN = state.reportParsed.length - abn.length;
      const block = '化验摘要：' +
        (abn.length ? abn.map((x) => x.name + ' ' + x.val + (x.unit ? ' ' + x.unit : '') + '（' + reportDirLabel(x.dir) + '）').join('；') + '；' : '') +
        (okN ? '其余 ' + okN + ' 项在参考区间内。' : '');
      const old = (p.discharge.summary || '').trim();
      p.discharge.summary = old ? old + '\n' + block : block;
      scheduleSave(); renderAll(); renderHead();
      toast('解读摘要已并入出院小结');
      break;
    }
    case 'toggle-assistant': {
      if (window.innerWidth <= 1180) {
        const open = $('.shell').classList.toggle('assistant-open');
        $('#scrim').classList.toggle('show', open);
      } else {
        state.collapsed = !state.collapsed;
        $('.shell').classList.toggle('assistant-collapsed', state.collapsed);
        document.body.classList.toggle('assistant-collapsed', state.collapsed);
      }
      break;
    }
    case 'case-to-patient': { caseToPatient(Number(btn.dataset.case)); break; }
    case 'new-patient': openNewPatient(); break;
    case 'ask-del-patient': askDeletePatient(btn.dataset.id); break;
    case 'confirm-del-patient': doDeletePatient(btn.dataset.id); break;
    case 'clear-demo': askClearDemo(); break;
    case 'confirm-clear-demo': doClearDemo(); break;
    case 'dismiss-demo': state.demoHintHidden = true; renderRail(); break;
    case 'close-modal': $('.shell').classList.remove('assistant-open'); closeModal(); break;
    case 'save-patient': saveNewPatient(); break;
    case 'print': doPrint(); break;
    case 'export-word': exportMenu(); break;
    case 'export-case-word': exportWord(); break;
    case 'export-case-html': exportCaseHtml(); break;
    case 'export-case-txt': exportCaseTxt(); break;
    case 'export-all-html': exportAllHtml(); break;
    case 'export-csv': exportCsv(); break;
    case 'print-pdf': closeModal(); doPrint(); break;
    case 'export-report-word': exportReportWord(); break;
    case 'export-report-html': exportReportHtml(); break;
    case 'data-manage': openDataModal(); break;
    case 'profile-settings': openProfileModal(); break;
    case 'app-settings': openSettings(); break;
    case 'close-profile': closeModal(); break;
    case 'export-backup': exportBackup(); break;
    case 'save-help': openSaveHelp(); break;
    case 'corrupt-export': exportCorruptRaw(); break;
    case 'corrupt-accept': acceptCorrupt(); break;
    case 'corrupt-confirm': acceptCorruptNow(); break;
    case 'takeover-save': takeOverSave(); break;
    case 'import-overwrite': importBackup(true); break;
    case 'import-merge': importBackup(false); break;
    case 'open-sources': openSources(); break;
    case 'new-assessment': createAssessment(); break;
    case 'scale-manager': openScaleManager(); break;
    case 'scale-new': openScaleEditor(null); break;
    case 'scale-edit': openScaleEditor(scaleById(btn.dataset.sid)); break;
    case 'scale-save': saveScaleFromForm(btn.dataset.sid); break;
    case 'scale-delete': deleteScale(btn.dataset.sid); break;
    case 'gen-problems': {
      const a = latest(p);
      if (!a) return toast('请先完成康复评估');
      p.record.problems = deriveProblems(p, a);
      scheduleSave(); renderView(); toast('已根据评估生成康复问题');
      break;
    }
    case 'gen-goals': {
      const a = latest(p);
      if (!a) return toast('请先完成康复评估');
      const g = deriveGoals(p, a);
      p.record.problems = deriveProblems(p, a);
      p.record.goalsShort = g.short;
      p.record.goalsLong = g.long;
      if (!p.record.plan) p.record.plan = derivePlan(p, a);
      scheduleSave(); renderView(); renderHead(); toast('已生成康复问题与目标');
      break;
    }
    case 'plan-import': {
      const box = $('#planPaste');
      const text = box ? box.value : '';
      if (!text.trim()) { toast('请先粘贴要导入的治疗项'); break; }
      const res = importPlanPhrases(text);
      state.planMissed = res.missed;
      if (res.added.length) toast('已匹配写入：' + res.added.join('、'));
      else if (!res.missed.length) toast('未识别到新项目');
      renderView(); renderHead();
      break;
    }
    case 'clean-neuro-scale': {
      const a = latest(p);
      if (!a) break;
      const nar = assessmentNarrative(p, a);
      const pat = nar.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/\s+/g, '\\s*');
      const m = (p.record.neuro || '').match(new RegExp(pat));
      if (!m) { toast('未找到与本次评定一致的评分段，未做改动'); break; }
      p.record.neuro = p.record.neuro.replace(m[0], '').replace(/\s{2,}/g, ' ').trim();
      scheduleSave(); renderAll(); toast('已移除专科查体里的量表评分段');
      break;
    }
    case 'add-diag': openPillModal('diagnosis'); break;
    case 'add-problem': openPillModal('problem'); break;
    case 'remove-diag': p.record.diagnoses.splice(Number(btn.dataset.i), 1); scheduleSave(); renderView(); renderHead(); break;
    case 'remove-problem': p.record.problems.splice(Number(btn.dataset.i), 1); scheduleSave(); renderView(); break;
    case 'gen-ddx': {
      const p = P();
      const sel = $('#ddxDiseaseSelect');
      const selVal = sel ? sel.value : '__auto__';
      const input = $('#ddxInput');
      state.ddxDraft = input ? input.value : '';
      let key;
      if (selVal !== '__auto__') {
        // 用户主动选了病种下拉 → 直接用
        key = selVal;
      } else {
        // 自动识别：粘贴文本优先，没命中才用现病史/诊断兜底
        const t = state.ddxDraft.trim();
        const hit = DISEASE_KEYWORDS.some((d) => d.words.some((w) => t.toLowerCase().indexOf(w.toLowerCase()) >= 0));
        key = (t && hit) ? detectDisease(t) : (p.diseaseKey || detectDisease((p.record.present || '') + ' ' + (p.diagShort || '')));
      }
      // 如果已有鉴别诊断条目 >0 但 key 不同，也重新生成（方便医生切换病种）
      p.record.diffDx = { key, items: ddxFromDict(key) };
      p.diseaseKey = key;
      const name = (DISEASE_KEYWORDS.find((x) => x.key === key) || {}).name || '';
      scheduleSave(); renderView(); renderHead();
      toast('⚡ 已生成「' + name + '」鉴别诊断 ' + p.record.diffDx.items.length + ' 条');
      break;
    }
    case 'present-cand': p.record.present = btn.dataset.text || ''; scheduleSave(); renderAll(); renderHead(); toast('已填入现病史候选'); break;
    case 'add-ddx': p.record.diffDx.items.push({ d: '', support: '', against: '', advice: '' }); scheduleSave(); renderView(); break;
    case 'remove-ddx': p.record.diffDx.items.splice(Number(btn.dataset.i), 1); scheduleSave(); renderView(); renderHead(); break;
    case 'add-plan-item': p.record.planItems.push({ name: '', frequency: '', duration: '', therapist: '' }); scheduleSave(); renderView(); break;
    case 'remove-plan-item': p.record.planItems.splice(Number(btn.dataset.i), 1); scheduleSave(); renderView(); break;
    case 'voice-ddx': { const t = $('#ddxInput'); if (t) startVoice(t); break; }
    case 'voice-draft': { const t = $('[data-draft]'); if (t) startVoice(t); break; }
    case 'gen-draft': {
      state.draft = composeText(p);
      renderView(); renderAssistant(); break;
    }
    case 'gen-draft-assess': {
      const a = latest(p);
      if (!a) return toast('请先完成康复评估');
      const g = deriveGoals(p, a);
      p.record.goalsShort = p.record.goalsShort || g.short;
      const b = barthelTotal(a), bg = bergTotal(a);
      const prev = previous(p);
      /* 只有"前一次也评过这一项"才谈得上较前变化，否则 (本次 - 0) 会写出"较前提高 70 分" */
      const deltaB = (prev && isTouched(prev, 'barthel')) ? b - barthelTotal(prev) : 0;
      const deltaG = (prev && isTouched(prev, 'berg')) ? bg - bergTotal(prev) : 0;
      const scoreTxt = [];
      if (isTouched(a, 'barthel')) scoreTxt.push('Barthel 指数 ' + b + ' 分' + (deltaB ? '（较前' + (deltaB > 0 ? '提高 ' : '下降 ') + Math.abs(deltaB) + ' 分）' : ''));
      if (isTouched(a, 'berg')) scoreTxt.push('Berg 平衡 ' + bg + ' 分' + (deltaG ? '（较前' + (deltaG > 0 ? '提高 ' : '下降 ') + Math.abs(deltaG) + ' 分）' : ''));
      state.draft = '患者' + (p.record.present ? '今日一般情况可' : '神志清，精神可') + '，' + (p.side && p.side !== '双侧' ? p.side + '侧肢体偏瘫，' : '') +
        (scoreTxt.length ? scoreTxt.join('，') + '，' : '今日未录入量表评分，') +
        (p.record.plan ? '继续' + p.record.plan.split('；')[0].replace(/^[^：]*：/, '') + '等康复训练。' : '继续综合康复训练。');
      renderView(); renderAssistant(); toast('已按评估生成草稿');
      break;
    }
    case 'use-draft': {
      if (!state.draft) return toast('草稿为空');
      state.tab = 'course'; renderTabs(); renderView(); renderAssistant(); goDraft(); break;
    }
    case 'clear-draft': state.draft = ''; state.noteAdverse = ''; state.editingNoteId = ''; renderView(); renderAssistant(); break;
    case 'note-skeleton': {
      const type = (state.compose && state.compose.noteType) || 'daily';
      const sk = noteSkeleton(p, type);
      state.draft = sk || composeText(p);
      renderView(); renderAssistant(); goDraft(); break;
    }
    case 'submit-note': {
      const text = state.draft.trim();
      if (text.length < 8) return toast('病程内容过短，请补充后再保存');
      const type = (state.compose && NOTE_TYPES.indexOf(state.compose.noteType) >= 0) ? state.compose.noteType : 'daily';
      const editing = state.editingNoteId ? p.notes.find((n) => n.id === state.editingNoteId) : null;
      if (editing) {
        // 编辑保存：原地替换内容与类型，保留原记录日期和保存时的落款
        editing.text = text;
        editing.adverse = state.noteAdverse.trim();
        editing.type = type;
        state.editingNoteId = '';
        state.draft = '';
        state.noteAdverse = '';
        scheduleSave(); renderAll(); toast('病程已更新');
        break;
      }
      const author = type === 'round' ? (state.supervisor || state.doctor) : state.doctor;
      p.notes.push({ id: uid(), date: todayISO(), author, type, text, adverse: state.noteAdverse.trim() });
      state.draft = '';
      state.noteAdverse = '';
      scheduleSave(); renderAll(); toast('病程已保存');
      break;
    }
    case 'fill-template': {
      refreshDiseaseKey(p);
      const filled = fillEmptyFromTemplate(p);
      scheduleSave(); renderAll();
      toast(filled > 0 ? '⚡ 已补全 ' + filled + ' 个空字段，__ 处数字请核实' : '空字段已全部填好，无需补全');
      break;
    }
    case 'apply-bingli-template': {
      const sel = document.getElementById('bingliTplSelect');
      const key = sel ? sel.value : '';
      if (!key) { toast('请先从下拉里选一份模板'); break; }
      if (typeof TEMPLATES_BINGLI === 'undefined') { toast('模板库未加载'); break; }
      const tpl = TEMPLATES_BINGLI.find(x => x.key === key);
      if (!tpl) { toast('模板未找到'); break; }
      const filled = mergeBingliTemplate(p, tpl);
      refreshDiseaseKey(p);
      scheduleSave(); renderAll();
      if (filled > 0) toast('⚡ 套用「' + tpl.name + '」：补了 ' + filled + ' 处空字段，已填内容未动');
      else toast('已填字段都没空，没补任何东西');
      break;
    }
    case 'auto-fill-all': {
      // 全局一键完成：病种模板 + 评估派生 + 鉴别诊断 + 出院医嘱推荐
      refreshDiseaseKey(p);
      let filled = fillEmptyFromTemplate(p);
      // 评估派生的问题/目标/方案
      const a = latest(p);
      if (a) {
        if (!p.record.problems.length) { p.record.problems = deriveProblems(p, a); filled++; }
        const g = deriveGoals(p, a);
        if (!p.record.goalsShort && g.short) { p.record.goalsShort = g.short; filled++; }
        if (!p.record.goalsLong && g.long) { p.record.goalsLong = g.long; filled++; }
        if (!p.record.plan) { p.record.plan = derivePlan(p, a); filled++; }
        // 评估摘要写入专科查体
        if (!(p.record.neuro || '').trim()) { p.record.neuro = assessmentNarrative(p, a); filled++; }
      }
      // 出院医嘱按病种匹配
      if (!p.discharge.advice.length) {
        const tplKey = DISEASE_TO_DISCHARGE_TPL[p.diseaseKey] || 'general';
        const tpl = DISCHARGE_TEMPLATES[tplKey];
        if (tpl) { p.discharge.templateKey = tplKey; p.discharge.advice = tpl.items.slice(); p.discharge.checked = tpl.items.map((_, i) => i); filled++; }
      }
      // 出院小结自动生成
      if (p.status === '已出院' && !(p.discharge.summary || '').trim()) {
        p.discharge.summary = buildDischargeSummary(p);
        if (!p.discharge.date) p.discharge.date = todayISO();
        filled++;
      }
      scheduleSave(); renderAll();
      toast(filled > 0 ? '⚡ 全部搞定！共补全 ' + filled + ' 处。__ 处数字和日期请核实' : '已是最全状态，无需补');
      break;
    }
    case 'del-note': {
      const id = btn.dataset.id;
      const n = p.notes.find((x) => x.id === id);
      if (!n) break;
      // 页面内二次确认：第一次点只切换为「确认删除」，避免原生 confirm 被内嵌预览拦截
      if (state.pendingDeleteId !== id) {
        state.pendingDeleteId = id;
        renderView();
        toast('再点一次「确认删除」才会删除，点「取消」可放弃');
        break;
      }
      state.pendingDeleteId = '';
      p.notes = p.notes.filter((x) => x.id !== id);
      if (state.editingNoteId === id) { state.editingNoteId = ''; state.draft = ''; state.noteAdverse = ''; }
      scheduleSave(); renderAll(); toast('已删除');
      break;
    }
    case 'cancel-del': {
      state.pendingDeleteId = '';
      renderView();
      break;
    }
    case 'copy-note': {
      const n = p.notes.find((x) => x.id === btn.dataset.id);
      if (n) { navigator.clipboard && navigator.clipboard.writeText(n.text).catch(() => {}); toast('已复制到剪贴板'); }
      break;
    }
    case 'edit-note': {
      const n = p.notes.find((x) => x.id === btn.dataset.id);
      if (n) {
        // 进入编辑态：原记录保留在时间线，保存时才替换；中途取消/切患者不会丢记录
        state.pendingDeleteId = '';
        state.editingNoteId = n.id;
        state.draft = n.text;
        state.noteAdverse = n.adverse || '';
        if (!state.compose) state.compose = defaultCompose(p);
        state.compose.noteType = NOTE_TYPES.indexOf(n.type) >= 0 ? n.type : 'daily';
        scheduleSave(); renderAll(); goDraft();
      }
      break;
    }
    case 'cancel-edit': {
      state.editingNoteId = '';
      state.draft = '';
      state.noteAdverse = '';
      scheduleSave(); renderAll(); toast('已取消编辑，原记录未改动');
      break;
    }
    case 'gen-discharge': {
      p.discharge.summary = buildDischargeSummary(p);
      if (!p.discharge.date) p.discharge.date = todayISO();
      scheduleSave(); renderView(); renderHead(); toast('已生成出院小结');
      break;
    }
    case 'add-advice': {
      p.discharge.advice.push('');
      p.discharge.checked.push(p.discharge.advice.length - 1);
      scheduleSave(); renderView(); break;
    }
    case 'toggle-advice': {
      const i = Number(btn.dataset.i);
      const pos = p.discharge.checked.indexOf(i);
      if (pos >= 0) p.discharge.checked.splice(pos, 1); else p.discharge.checked.push(i);
      scheduleSave(); renderView(); renderTabs(); break;
    }
    case 'remove-advice': {
      const i = Number(btn.dataset.i);
      p.discharge.advice.splice(i, 1);
      p.discharge.checked = p.discharge.checked.filter((x) => x !== i).map((x) => (x > i ? x - 1 : x));
      scheduleSave(); renderView(); renderTabs(); break;
    }
    /* ---------- ROS 系统回顾 操作 ---------- */
    case 'ros-all-negative': {
      if (typeof BINGLI_SCHEMA === 'undefined') break;
      BINGLI_SCHEMA.ROS.forEach(g => {
        if (!p.record.ros[g.key]) p.record.ros[g.key] = {};
        g.symptoms.forEach(s => { p.record.ros[g.key][s.key] = { negative: true }; });
      });
      scheduleSave(); renderView(); toast('全部标记为阴性'); break;
    }
    case 'ros-clear': { p.record.ros = {}; scheduleSave(); renderView(); toast('已清空系统回顾'); break; }
    case 'ros-insert-history': {
      const t = rosToText(p.record.ros);
      if (!t) return toast('系统回顾里还没标记任何阳性或阴性');
      const seg = '\n\n【系统回顾】' + t;
      p.record.present = (p.record.present || '').replace(/\n*【系统回顾】.*$/, '') + seg;
      scheduleSave(); renderView(); toast('已追加到现病史末尾'); break;
    }
    /* ---------- PE 体格检查 操作 ---------- */
    case 'pe-gen-exam-text': {
      const pe = p.record.pe || {};
      const generalText = peCommonText(pe);
      const specialText = peSpecialText(pe);
      if (!generalText && !specialText) return toast('请先在上方点选查体项目');
      p.record.examParts = p.record.examParts || {};
      if (generalText) {
        const curGeneral = (p.record.examParts.general || '').trim();
        p.record.examParts.general = curGeneral ? curGeneral + '\n\n' + generalText : generalText;
      }
      if (specialText) {
        const curNeuro = (p.record.neuro || '').trim();
        p.record.neuro = curNeuro ? curNeuro + ' ' + specialText : specialText;
      }
      p.record.exam = examPartsJoin(p.record.examParts);
      scheduleSave(); renderView();
      toast(generalText && specialText ? '一般查体与专科阳性项已分别写入查体段、专科查体段' : (generalText ? '一般查体文本已生成并写入' : '专科查体阳性项已写入专科查体段'));
      break;
    }
    default: console.warn('[desk] 未处理的 data-action:', act);
  }
});

function goDraft() {
  setTimeout(() => {
    const t = $('[data-draft]');
    if (t) { t.focus(); t.setSelectionRange(t.value.length, t.value.length); t.scrollIntoView({ block: 'center', behavior: 'smooth' }); }
  }, 60);
}

/* ---------------- 语音输入（浏览器自带 Web Speech API） ----------------
   依赖浏览器厂商语音服务：Chrome/Edge 可用，需联网；Firefox/Safari 不支持。 */
function startVoice(inputEl) {
  const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
  if (!SR) return toast('当前浏览器不支持语音输入（请用 Chrome / Edge）');
  if (state.voiceRec) { state.voiceRec.stop(); return; }
  const rec = new SR();
  state.voiceRec = rec;
  const voicePatientId = state.currentId;   // 捕获触发时患者，识别期间切患者则丢弃结果，防跨患者串写
  rec.lang = 'zh-CN';
  rec.interimResults = false;
  rec.maxAlternatives = 1;
  rec.onresult = (e) => {
    const t = (e.results[0][0].transcript || '').replace(/[。，\s]+$/, '');
    if (!t) return;
    if (state.currentId !== voicePatientId) { toast('患者已切换，本次口述未写入，请重新开始'); return; }
    // 识别期间若发生过重渲染，旧元素已脱离文档；按选择器重查当前控件，找不到则放弃本次结果
    let el = document.body.contains(inputEl) ? inputEl : null;
    if (!el) {
      const sel = inputEl.dataset.bind ? '[data-bind="' + inputEl.dataset.bind + '"]'
        : inputEl.hasAttribute('data-draft') ? '[data-draft]'
        : inputEl.id ? '#' + inputEl.id : null;
      el = sel ? $(sel) : null;
    }
    if (!el) { toast('输入框已刷新，请重新口述'); return; }
    const v = el.value.trim();
    el.value = v ? v + (v.slice(-1) === '。' ? '' : '，') + t : t;
    el.dispatchEvent(new Event('input', { bubbles: true }));
  };
  rec.onend = () => { state.voiceRec = null; };
  rec.onerror = (e) => {
    state.voiceRec = null;
    if (e.error === 'not-allowed' || e.error === 'service-not-allowed') toast('语音识别被拒绝（需联网，Chrome/Edge 可用）');
    else if (e.error !== 'aborted' && e.error !== 'no-speech') toast('语音识别失败：' + e.error);
  };
  try { rec.start(); toast('正在聆听，请说话…'); } catch (err) { state.voiceRec = null; toast('语音识别启动失败'); }
}

document.addEventListener('focus', (e) => {
  const el = e.target.closest && e.target.closest('[data-edit]');
  if (el && el.innerText.trim() === '—') el.innerText = '';
}, true);

document.addEventListener('blur', (e) => {
  const el = e.target.closest && e.target.closest('[data-edit]');
  if (el) commitInlineEdit(el);
}, true);

/* 中文输入法组合态：拼写过程中不重建页面，否则候选框会被打断、光标乱跳；
   组合结束后补发一次 input，让被跳过的那次更新生效 */
document.addEventListener('compositionstart', () => { isComposing = true; }, true);
document.addEventListener('compositionend', (e) => {
  isComposing = false;
  const t = e.target;
  if (t && t.dispatchEvent) {
    setTimeout(() => { try { t.dispatchEvent(new Event('input', { bubbles: true })); } catch (err) { /* 忽略 */ } }, 0);
  }
}, true);

document.addEventListener('input', (e) => {
  if (isComposing) return;
  const t = e.target;
  const PROFILE_MAP = { profileHospital: 'hospital', profileDept: 'dept', profileDoctor: 'doctor', profileTitle: 'doctorTitle', profileSupervisor: 'supervisor' };
  if (PROFILE_MAP[t.id] != null) { state[PROFILE_MAP[t.id]] = t.value; scheduleSave(); return; }
  if (t.id === 'patientSearch') { state.search = t.value; debounceRun('rail-search', () => renderRail(), 120); return; }
  if (t.id === 'noteSearch') {
    state.noteQuery = t.value;
    debounceRun('note-search', () => { const box = $('#noteList'); if (box) box.innerHTML = noteCardsHtml(); }, 120);
    return;
  }
  if (t.id === 'assessSearch') {
    state.assessQuery = t.value;
    debounceRun('assess-search', () => {
      const box = $('#assessBody');
      if (box) { const p = P(); const a = p && latest(p); box.innerHTML = assessBodyHtml(p, a); }
    }, 120);
    return;
  }
  if (t.id === 'parseInput') { state.parseDraft = t.value; return; }
  if (t.id === 'reportInput') { state.reportDraft = t.value; return; }
  if (t.dataset.bind) { handleBind(t); return; }
  /* ---------- ROS detail 输入 ---------- */
  if (t.dataset.rosDetail) {
    const p = P();
    const [sysKey, symKey] = t.dataset.rosDetail.split('.');
    if (!p.record.ros[sysKey]) p.record.ros[sysKey] = {};
    const cur = p.record.ros[sysKey][symKey] || { checked: true };
    cur.checked = true;
    cur.detail = t.value;
    p.record.ros[sysKey][symKey] = cur;
    scheduleSave(); return;
  }
  /* ---------- PE 项输入/下拉 ---------- */
  if (t.dataset.pe) {
    const p = P();
    const [gKey, itemKey] = t.dataset.pe.split('.');
    if (!p.record.pe[gKey]) p.record.pe[gKey] = {};
    p.record.pe[gKey][itemKey] = t.value;
    scheduleSave(); return;
  }
  if (t.hasAttribute('data-draft')) { state.draft = t.value; const tip = t.closest('.composer').querySelector('.count-tip'); if (tip) tip.textContent = t.value ? t.value.length + ' 字' : '草稿为空'; return; }
  if (t.hasAttribute('data-adverse')) { state.noteAdverse = t.value; return; }
  if (t.dataset.advice != null) {
    const p = P();
    p.discharge.advice[Number(t.dataset.advice)] = t.value;
    scheduleSave();
    return;
  }
  if (t.dataset.pi != null) {
    const p = P(); const items = p.record.planItems; const i = Number(t.dataset.i);
    if (items && items[i]) { items[i][t.dataset.pi] = t.value; scheduleSave(); }
    return;
  }
  const ddxFieldMap = { ddxD: 'd', ddxS: 'support', ddxA: 'against', ddxC: 'advice' };
  const ddxKey = Object.keys(ddxFieldMap).find((k) => t.dataset[k] != null);
  if (ddxKey) {
    const p = P();
    const i = Number(t.dataset[ddxKey]);
    const it = p.record.diffDx.items[i];
    if (it) it[ddxFieldMap[ddxKey]] = t.value;
    scheduleSave();
    return;
  }
  if (t.id === 'ddxInput') { state.ddxDraft = t.value; return; }
  if (t.hasAttribute('data-cslider')) {
    const p = P(); const a = p && latest(p); const def = a && scaleById(t.dataset.cslider);
    if (!a || !def) return;
    if (!isObj(a.custom)) a.custom = {};
    if (!isObj(a.custom[def.id])) a.custom[def.id] = {};
    a.custom[def.id].value = clamp(Number(t.value), 0, def.max || 10);
    markTouch(a, 'custom:' + def.id);
    const val = t.closest('.vas-wrap').querySelector('.vas-val');
    if (val) val.textContent = t.value;
    scheduleSave();
    return;
  }
  if (t.hasAttribute('data-vas')) {
    const p = P(); const a = p && latest(p);
    if (!a) return;
    a.vas = clamp(Number(t.value), 0, 10);
    markTouch(a, 'vas');
    const val = t.closest('.vas-wrap').querySelector('.vas-val');
    if (val) val.textContent = t.value;
    scheduleSave();
  }
});

document.addEventListener('change', (e) => {
  const t = e.target;
  if (t.id === 'ddxDiseaseSelect') {
    // 选了病种下拉 → 直接触发重新生成鉴别诊断
    const p = P();
    const key = t.value === '__auto__' ? (p.diseaseKey || detectDisease((p.record.present || '') + ' ' + (p.diagShort || ''))) : t.value;
    p.record.diffDx = { key, items: ddxFromDict(key) };
    p.diseaseKey = key;
    const name = (DISEASE_KEYWORDS.find((x) => x.key === key) || {}).name || '';
    scheduleSave(); renderView(); renderHead();
    toast('⚡ 已切换为「' + name + '」鉴别诊断');
    return;
  }
  if (t.hasAttribute('data-assess')) { handleAssess(t); return; }
  if (t.dataset.bind) { handleBind(t); return; }
  if (t.dataset.pe) {
    const p = P();
    const [gKey, itemKey] = t.dataset.pe.split('.');
    if (!p.record.pe[gKey]) p.record.pe[gKey] = {};
    p.record.pe[gKey][itemKey] = t.value;
    scheduleSave(); return;
  }
  if (t.hasAttribute('data-assess-date')) {
    const p = P(); const a = p && latest(p);
    if (!a) return;
    const v = normDate(t.value) || todayISO();
    a.date = v;
    if (dateTs(v) > dateTs(todayISO())) toast('评定日期晚于今天，请核对');
    else if (p.admitDate && dateTs(v) < dateTs(p.admitDate)) toast('评定日期早于入院日期，请核对');
    scheduleSave(); renderView(); renderHead(); return;
  }
  if (t.hasAttribute('data-vas')) { renderView(); renderHead(); renderTabs(); return; }
  if (t.dataset.compose) {
    state.compose[t.dataset.compose] = t.value;
    if (t.dataset.compose === 'noteType' && state.compose.noteType !== 'daily') {
      state.draft = noteSkeleton(P(), state.compose.noteType);
    }
    renderView(); renderAssistant(); return;
  }
  if (t.dataset.pi != null) {
    const p = P(); const items = p.record.planItems; const i = Number(t.dataset.i);
    if (items && items[i]) { items[i][t.dataset.pi] = t.value; scheduleSave(); }
    return;
  }
});

document.addEventListener('keydown', (e) => {
  // 患者卡片是 role=button 的 div，补回车/空格切患者
  if ((e.key === 'Enter' || e.key === ' ') && e.target.matches && e.target.matches('.patient-card[data-patient]')) {
    e.preventDefault(); selectPatient(e.target.dataset.patient); return;
  }
  if ((e.key === 'Enter' || e.key === ' ') && e.target.matches && e.target.matches('[data-kn-toggle]')) {
    e.preventDefault(); state.knOpen = !knOpenNow(); renderView(); return;
  }
  if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 's') { e.preventDefault(); persistNow(); toast('已保存'); }
  if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'p') { e.preventDefault(); doPrint(); }
  if (e.key === 'Escape') closeModal();
});

/* ---------------- 新增评估 / 患者 ---------------- */
function createAssessment() {
  const p = P();
  const last = latest(p);
  const a = last ? clone(last) : null;
  const blank = {
    date: todayISO(),
    mmt: {}, mas: {}, brunnstrom: { upper: 'Ⅰ', hand: 'Ⅰ', lower: 'Ⅰ' },
    barthel: {}, berg: new Array(14).fill(0), mmse: {}, kouda: 1, holden: 0, vas: 0, custom: {}, touched: {}
  };
  MMT_GROUPS.forEach((g) => { blank.mmt[g] = [0, 0]; });
  MAS_GROUPS.forEach((g) => { blank.mas[g] = ['0', '0']; });
  BARTHEL_ITEMS.forEach((it) => { blank.barthel[it.key] = 0; });
  MMSE_ITEMS.forEach((it) => { blank.mmse[it.key] = 0; });
  if (a) { a.date = todayISO(); a.id = uid(); }
  p.assessments.push(a || blank);
  state.tab = 'assess'; state.assessTab = 'motor'; state.assessFilter = 'scale';
  scheduleSave(); renderAll(); toast(a ? '已复制上次评估，可直接修改' : '已创建首次评估');
}

/* ---------------- 患者管理：删除单份 / 清空演示数据 ---------------- */
function askDeletePatient(id) {
  const t = state.patients.find((x) => x.id === id);
  if (!t) return;
  const nNotes = (t.notes || []).length, nAssess = (t.assessments || []).length;
  $('#modal').innerHTML = '<div class="modal-head"><h3>删除这份病历？</h3><button class="icon-btn x" data-action="close-modal">×</button></div>' +
    '<div class="modal-body">' +
    '<p class="confirm-main">将要删除：<b>' + esc(t.name) + '</b>（' + esc(t.bed) + ' 床 · ' + esc(t.diagShort) + '）</p>' +
    '<p class="confirm-sub">其中 ' + nNotes + ' 条病程记录、' + nAssess + ' 次评估会一起删掉，删除后无法恢复。</p>' +
    '<p class="confirm-sub">拿不准就先点下面「导出备份」，存一份再删。</p>' +
    '</div><div class="modal-foot">' +
    '<button class="btn outline" data-action="close-modal">取消</button>' +
    '<button class="btn outline" data-action="export-backup">导出备份</button>' +
    '<button class="btn danger" data-action="confirm-del-patient" data-id="' + esc(id) + '">确认删除</button></div>';
  openModal();
}

function doDeletePatient(id) {
  const idx = state.patients.findIndex((x) => x.id === id);
  if (idx < 0) return;
  const wasCurrent = state.currentId === id;
  state.patients.splice(idx, 1);
  if (isObj(state.drafts)) delete state.drafts[id];
  if (wasCurrent) {
    const next = state.patients[idx] || state.patients[idx - 1] || null;
    state.currentId = next ? next.id : null;
  }
  closeModal();
  scheduleSave();
  renderAll();
  toast('已删除该病历');
}

function askClearDemo() {
  if (!isDemoDeck()) return;
  $('#modal').innerHTML = '<div class="modal-head"><h3>清空演示病人，开始用自己的</h3><button class="icon-btn x" data-action="close-modal">×</button></div>' +
    '<div class="modal-body">' +
    '<p class="confirm-main">将清除这 ' + state.patients.length + ' 份演示病人。</p>' +
    '<p class="confirm-sub">你自己新建的病人、医师资料、自建量表都不会动。清空前会自动导出一份备份，万一后悔还能导回来。</p>' +
    '</div><div class="modal-foot">' +
    '<button class="btn outline" data-action="close-modal">先不清</button>' +
    '<button class="btn solid" data-action="confirm-clear-demo">清空，并开始录我的病人</button></div>';
  openModal();
}

function doClearDemo() {
  if (!isDemoDeck()) { closeModal(); return; }
  try { exportBackup(); } catch (e) { console.warn('清空前备份失败', e); }
  state.patients = [];
  state.currentId = null;
  state.drafts = {};
  state.search = '';
  state.filter = 'all';
  state.demoHintHidden = true;
  closeModal();
  scheduleSave();
  renderAll();
  toast('演示数据已清空，点「新建患者」开始录你自己的病人');
}

function openNewPatient() {
  const m = $('#modal');
  m.innerHTML = '<div class="modal-head"><h3>新建患者</h3><button class="icon-btn x" data-action="close-modal">×</button></div>' +
    '<div class="modal-body"><div class="form-grid modal-grid">' +
    '<div class="field"><label>姓名 <span class="req">*</span></label><input id="npName" placeholder="患者姓名"></div>' +
    '<div class="field"><label>性别</label><select id="npGender"><option>男</option><option>女</option></select></div>' +
    '<div class="field"><label>年龄</label><input id="npAge" type="number" value="60"></div>' +
    '<div class="field"><label>床号</label><input id="npBed" placeholder="如 12-3 / 门诊"></div>' +
    '<div class="field"><label>住院号</label><input id="npMrn" placeholder="如 2026-0450"></div>' +
    '<div class="field"><label>入院日期</label><input id="npDate" type="date" value="' + todayISO() + '"></div>' +
    '<div class="field"><label>患者状态</label><select id="npStatus"><option>住院</option><option>门诊</option></select></div>' +
    '<div class="field"><label>患侧</label><select id="npSide"><option value="">无</option><option>左</option><option>右</option><option>双侧</option></select></div>' +
    '<div class="field"><label>病种模板</label><select id="npTpl">' +
      '<option value="none" selected>不预填（空白建档 · 推荐）</option>' +
      '<option value="auto">自动识别病种并预填</option>' +
      Object.keys(ADMIT_TEMPLATES).map((k) => '<option value="' + k + '">' + esc(ADMIT_TEMPLATES[k].name) + '</option>').join('') +
      '</select></div>' +
    '<div class="field wide"><label>主要诊断</label><input id="npDiag" placeholder="如 脑梗死恢复期 · 右侧偏瘫"></div>' +
    '<div class="field wide"><label>主诉</label><input id="npChief" placeholder="如 右侧肢体活动不利 1 月"></div>' +
    '<div class="field wide"><div class="asst-hint" id="npTplHint" style="padding:0">填写诊断或主诉后自动识别病种，保存时将按模板预填整套入院记录。</div></div>' +
    '</div></div><div class="modal-foot"><button class="btn outline" data-action="close-modal">取消</button><button class="btn solid" data-action="save-patient">创建并开始书写</button></div>';
  openModal();
  const hint = $('#npTplHint');
  const updateHint = () => {
    const sel = $('#npTpl');
    if (sel.value === 'none') { hint.textContent = '已选择不预填：将创建空白档案，由医生自行书写。'; return; }
    const key = sel.value === 'auto' ? detectDisease(($('#npDiag').value || '') + ' ' + ($('#npChief').value || '')) : sel.value;
    const name = (DISEASE_KEYWORDS.find((x) => x.key === key) || {}).name || '';
    hint.textContent = '识别为「' + name + '」：保存时将预填主诉、现病史、查体、中医四诊、诊断、目标与方案，医生只需改数字（__ 处）。';
  };
  $('#npDiag').addEventListener('input', updateHint);
  $('#npChief').addEventListener('input', updateHint);
  $('#npTpl').addEventListener('change', updateHint);
  updateHint();
  setTimeout(() => $('#npName').focus(), 120);
}

function saveNewPatient() {
  const name = ($('#npName').value || '').trim();
  if (!name) return toast('请填写患者姓名');
  const diag = ($('#npDiag').value || '').trim();
  const tplSel = $('#npTpl').value;
  const tplKey = tplSel === 'none' ? null : (tplSel === 'auto' ? detectDisease(diag + ' ' + ($('#npChief').value || '')) : tplSel);
  const T = tplKey && ADMIT_TEMPLATES[tplKey] ? ADMIT_TEMPLATES[tplKey] : null;
  const p = {
    id: uniquePatientId(), name, gender: $('#npGender').value, age: $('#npAge').value === '' ? '' : asNum($('#npAge').value, 0),
    bed: $('#npBed').value.trim() || '—', mrn: $('#npMrn').value.trim() || 'MZ-' + Date.now().toString().slice(-6),
    dept: '康复医学科', status: $('#npStatus').value, admitDate: normDate($('#npDate').value) || todayISO(),
    diagShort: diag || (T ? T.diagnoses[0].replace(/ __.*$/, '') : '待明确'), side: $('#npSide').value, phone: '',
    record: {
      chief: ($('#npChief').value || '').trim() || (T ? T.chief : ''),
      present: T ? T.present : '', past: T ? T.past : '', personal: T ? T.personal : '', family: T ? T.family : '', allergy: T ? T.allergy : '',
      vitals: T ? clone(T.vitals) : { t: '', p: '', r: '', bp: '', spo2: '' },
      exam: T ? T.exam : '', neuro: T ? T.neuro : '',
      diagnoses: diag ? [diag].concat(T ? T.diagnoses.filter((d) => d !== diag) : []) : (T ? T.diagnoses.slice() : []),
      problems: T ? T.problems.slice() : [], goalsShort: T ? T.goalsShort : '', goalsLong: T ? T.goalsLong : '', plan: T ? T.plan : '',
      tcm: T ? clone(T.tcm) : {}
    },
    assessments: [], notes: [],
    discharge: { date: '', summary: '', advice: [], checked: [], followUp: '', templateKey: '' }
  };
  normalizePatient(p);
  if (T && DIFF_DX[tplKey]) p.record.diffDx = { key: tplKey, items: ddxFromDict(tplKey) };
  state.patients.unshift(p);
  selectPatient(p.id);
  state.tab = 'admit';
  closeModal(); scheduleSave(); renderAll();
  toast(T ? '已创建并预填「' + T.name + '」模板，请修改 __ 处数字' : '已创建空白档案');
}

function openPillModal(kind) {
  const isDiag = kind === 'diagnosis';
  $('#modal').innerHTML = '<div class="modal-head"><h3>' + (isDiag ? '添加诊断' : '添加康复问题') + '</h3><button class="icon-btn x" data-action="close-modal">×</button></div>' +
    '<div class="modal-body"><div class="field"><label>' + (isDiag ? '诊断名称' : '问题描述') + '</label><input id="pillInput" placeholder="' + (isDiag ? '如 脑梗死恢复期' : '如 平衡功能下降（Berg 18 分）') + '"></div></div>' +
    '<div class="modal-foot"><button class="btn outline" data-action="close-modal">取消</button><button class="btn solid" id="pillSave">添加</button></div>';
  openModal();
  setTimeout(() => {
    const input = $('#pillInput');
    input.focus();
    const submit = () => {
      const v = input.value.trim();
      if (!v) return;
      const p = P();
      (isDiag ? p.record.diagnoses : p.record.problems).push(v);
      closeModal(); scheduleSave(); renderView(); renderHead(); toast('已添加');
    };
    $('#pillSave').addEventListener('click', submit);
    input.addEventListener('keydown', (e) => { if (e.key === 'Enter') submit(); });
  }, 80);
}

function openSources() {
  $('#modal').innerHTML = '<div class="modal-head"><h3>量表评分依据与出处</h3><button class="icon-btn x" data-action="close-modal">×</button></div>' +
    '<div class="modal-body"><div class="asst-hint" style="padding:0 0 12px">以下为工作台量表的评分口径来源（v1.21 新增 Fugl-Meyer、TUG、6MWT、ODI、WOMAC、FIM、NIHSS、MoCA、EAT-10、Braden、Morse、Caprini、NRS2002、PHQ-9、GAD-7 等 22 项）。分级 cutoff 为临床常用参考值，判读时需结合患者年龄、教育程度与整体情况，具体以量表原版为准。</div>' +
    '<div class="source-list">' + SCALE_SOURCES.map(([n, s]) => '<div class="source-item"><b>' + esc(n) + '</b><p>' + esc(s) + '</p></div>').join('') + '</div>' +
    // 内置验收口径随应用可见，便于科室自查；只读展示，不参与质控计分
    '<div class="asst-hint" style="padding:14px 0 6px"><b>内置验收口径</b>（结构与离线自包含的可核对项）</div>' +
    '<div class="source-list">' + ACCEPTANCE_CHECKLIST.map((c) => '<div class="source-item"><b>' + esc(c.area) + '</b><p>' + esc(c.rule) + '<br>验收：' + esc(c.verify) + '</p></div>').join('') + '</div>' +
    '</div><div class="modal-foot"><button class="btn outline" data-action="close-modal">关闭</button></div>';
  openModal();
}

function openModal() {
  $('#scrim').classList.add('show');
  $('#modalWrap').classList.add('show');
  $('#modalWrap').setAttribute('aria-hidden', 'false');
}
function closeModal() {
  // 医师资料模态关闭后需重渲染，使抬头与签名落款生效
  if ($('#profileHospital')) { scheduleSave(); renderAll(); }
  $('#scrim').classList.remove('show');
  $('#modalWrap').classList.remove('show');
  $('#modalWrap').setAttribute('aria-hidden', 'true');
}

/* ---------------- 数据备份 / 恢复 ---------------- */
let backupData = null;
// 备份顶层字段白名单：由持久化字段派生（见 PERSIST_KEYS / BACKUP_EXCLUDE），未列入的多余字段一律剔除
const BACKUP_TOP_KEYS = ['app', 'version', 'exportedAt', 'emergencyReason'].concat(PERSIST_KEYS.filter((k) => BACKUP_EXCLUDE.indexOf(k) < 0));
function sanitizeBackup(d) {
  if (!isObj(d)) return null;
  const out = {};
  BACKUP_TOP_KEYS.forEach((k) => { if (k in d) out[k] = d[k]; });
  if (!Array.isArray(out.patients)) return null;
  return out;
}

/* ---------------- 自定义量表管理（G5） ---------------- */
const SCALE_TAB_LABEL = { motor: '运动功能', func: '活动与平衡', special: '专项评估' };
function scaleTabOptions(sel) {
  return SCALE_TABS.map((t) => '<option value="' + t + '"' + (sel === t ? ' selected' : '') + '>' + SCALE_TAB_LABEL[t] + '</option>').join('');
}
function scaleKindOptions(sel) {
  return SCALE_KINDS.map((k) => '<option value="' + k + '"' + (sel === k ? ' selected' : '') + '>' + SCALE_KIND_LABEL[k] + '</option>').join('');
}

function openScaleManager() {
  const list = state.customScales;
  const rows = list.length ? list.map((d) => {
    const flags = [d.inSummary ? '汇总' : '', d.inTrend ? '趋势' : '', d.inNarrative ? '叙事' : ''].filter(Boolean).join(' / ');
    return '<div class="scale-mgr-row">' +
      '<div><b>' + esc(d.title) + '</b><p>' + esc(SCALE_KIND_LABEL[d.kind] || d.kind) + ' · ' + SCALE_TAB_LABEL[d.tab] + (flags ? ' · 入' + flags : '') + '</p></div>' +
      '<div class="spacer"></div>' +
      '<button class="btn small outline" data-action="scale-edit" data-sid="' + d.id + '">编辑</button>' +
      '<button class="btn small outline" data-action="scale-delete" data-sid="' + d.id + '">删除</button></div>';
  }).join('') : '<div class="asst-hint" style="padding:8px 0">尚未添加自定义量表。内置量表（Barthel / Berg / MMSE 等）已固定在评估页，不受影响。</div>';
  $('#modal').innerHTML = '<div class="modal-head"><h3>自定义评估量表管理</h3><button class="icon-btn x" data-action="close-modal">×</button></div>' +
    '<div class="modal-body">' + rows + '</div>' +
    '<div class="modal-foot"><button class="btn small outline" data-action="scale-new">＋ 新增量表</button><div class="spacer"></div><button class="btn outline" data-action="close-modal">关闭</button></div>';
  openModal();
}

function tplDefaultLevels(tplId) {
  if (['phq9', 'gad7'].indexOf(tplId) >= 0) return [[0, '0 从不'], [1, '1 几天'], [2, '2 一半以上天数'], [3, '3 几乎每天']];
  if (['odi', 'ndi'].indexOf(tplId) >= 0) return [[0, '0 无'], [1, '1 轻'], [2, '2 中'], [3, '3 较重'], [4, '4 重'], [5, '5 极重']];
  return null;
}

function applyScaleTemplate(tplId) {
  const tpl = asArr(typeof SCALE_TEMPLATES !== 'undefined' ? SCALE_TEMPLATES : []).find((x) => x.tpl === tplId);
  if (!tplId || !tpl) return;
  $('#scaleTitle').value = tpl.title || '';
  $('#scaleSub').value = tpl.sub || '';
  $('#scaleTab').value = tpl.tab || 'func';
  $('#scaleKind').value = tpl.kind || 'items-select';
  $('#scaleMax').value = tpl.max || '';
  $('#scaleNote').value = tpl.note || '';
  const defLv = tplDefaultLevels(tpl.tpl);
  const itemsText = (tpl.items || []).map((it) => {
    if (tpl.kind === 'items-select') { const lv = (it.levels && it.levels.length) ? it.levels : defLv; return it.label + '|' + (lv || []).map(([v, l]) => v + ':' + l).join(','); }
    if (tpl.kind === 'items-number') return it.label + '|' + (it.max || '');
    return it.label;
  }).join('\n');
  $('#scaleItems').value = itemsText;
  $('#scaleLevels').value = (tpl.levels || []).map((l) => l.v + ':' + l.label).join('\n');
  $('#scaleGrades').value = (tpl.grades || []).map((g) => g.max != null && g.max >= 0 ? g.min + ':' + g.max + ':' + g.label + ':' + g.level : g.min + ':' + g.label + ':' + g.level).join('\n');
}

function openScaleEditor(def) {
  const d = def || { id: '', title: '', sub: '', tab: 'func', kind: 'items-select', max: 100, note: '', items: [], levels: [], grades: [], inSummary: true, inTrend: false, inNarrative: true };
  const itemsText = d.items.map((it) => {
    if (d.kind === 'items-select') return it.label + '|' + (it.levels || []).map(([v, l]) => v + ':' + l).join(',');
    if (d.kind === 'items-number') return it.label + '|' + (it.max || '');
    return it.label;
  }).join('\n');
  const levelsText = d.levels.map((l) => l.v + ':' + l.label).join('\n');
  const gradesText = d.grades.map((g) => g.max != null && g.max >= 0 ? g.min + ':' + g.max + ':' + g.label + ':' + g.level : g.min + ':' + g.label + ':' + g.level).join('\n');
  const tplOptions = '<option value="">— 不套用模板，空白新建 —</option>' + asArr(typeof SCALE_TEMPLATES !== 'undefined' ? SCALE_TEMPLATES : []).map((t) => '<option value="' + esc(t.tpl) + '">' + esc(t.title) + '</option>').join('');
  $('#modal').innerHTML = '<div class="modal-head"><h3>' + (def ? '编辑量表' : '新增量表') + '</h3><button class="icon-btn x" data-action="close-modal">×</button></div>' +
    '<div class="modal-body">' +
    (def ? '' : '<div class="profile-field"><span>标准模板（套用后可再编辑）</span><select id="scaleTpl" onchange="applyScaleTemplate(this.value)">' + tplOptions + '</select></div>') +
    profileField('量表名称', 'scaleTitle', d.title, '如：手功能评定 / 平衡分级') +
    profileField('副标题（选填）', 'scaleSub', d.sub, '适用范围 / 评分说明') +
    '<div class="profile-field"><span>所属评估页签</span><select id="scaleTab">' + scaleTabOptions(d.tab) + '</select></div>' +
    '<div class="profile-field"><span>题型</span><select id="scaleKind">' + scaleKindOptions(d.kind) + '</select></div>' +
    profileField('总分上限（趋势/分级用，选填）', 'scaleMax', d.max || '', '如 100 / 56 / 30') +
    '<label class="profile-field"><span>条目（每行一条；下拉分值题型：「标签|分值:标签,分值:标签」；数值题型：「标签|上限」）</span><textarea id="scaleItems" rows="5" placeholder="进食|0:完全依赖,5:部分帮助,10:自理">' + esc(itemsText) + '</textarea></label>' +
    '<label class="profile-field"><span>档位（单等级 / 左右对称题型用，每行「分值:标签」）</span><textarea id="scaleLevels" rows="3" placeholder="0:无,1:轻微,2:明显">' + esc(levelsText) + '</textarea></label>' +
    '<label class="profile-field"><span>分级阈值（每行「下限:标签:级别 ok/warn/bad」，从高到低）</span><textarea id="scaleGrades" rows="3" placeholder="60:良好:ok,30:受限:warn,0:较差:bad">' + esc(gradesText) + '</textarea></label>' +
    profileField('备注（选填）', 'scaleNote', d.note, '评分注意事项') +
    '<div class="scale-checks">' +
    '<label><input type="checkbox" id="chkSummary"' + (d.inSummary ? ' checked' : '') + '> 计入顶部汇总指标</label>' +
    '<label><input type="checkbox" id="chkTrend"' + (d.inTrend ? ' checked' : '') + '> 计入功能趋势曲线</label>' +
    '<label><input type="checkbox" id="chkNarrative"' + (d.inNarrative ? ' checked' : '') + '> 写入评估摘要</label>' +
    '</div></div>' +
    '<div class="modal-foot"><button class="btn outline" data-action="close-modal">取消</button><button class="btn solid" data-action="scale-save" data-sid="' + esc(d.id) + '">保存量表</button></div>';
  openModal();
}

function parseScaleForm(sid) {
  const title = $('#scaleTitle').value.trim();
  if (!title) return { err: '请填写量表名称' };
  const kind = $('#scaleKind').value, tab = $('#scaleTab').value;
  const items = $('#scaleItems').value.split('\n').map((ln, k) => {
    ln = ln.trim(); if (!ln) return null;
    const parts = ln.split('|');
    const out = { key: 'k' + k, label: parts[0].trim() };
    if (kind === 'items-number') out.max = asNum(parts[1], 10);
    if (kind === 'items-select') out.levels = asStr(parts[1] || '').split(',').map((x) => { const [v, l] = x.split(':'); return [asNum(v, 0), (l || '').trim()]; }).filter((x) => x[1]);
    return out;
  }).filter(Boolean);
  const levels = $('#scaleLevels').value.split('\n').map((ln) => { ln = ln.trim(); if (!ln) return null; const [v, l] = ln.split(':'); return { v: (v || '').trim(), label: (l || '').trim() }; }).filter((x) => x && x.label);
  const grades = $('#scaleGrades').value.split('\n').map((ln) => {
    ln = ln.trim(); if (!ln) return null;
    const parts = ln.split(':');
    let min, max, label, level;
    if (parts.length >= 4) { min = parts[0]; max = parts[1]; label = parts[2]; level = parts[3]; }
    else { min = parts[0]; label = parts[1]; level = parts[2]; max = ''; }
    return { min: asNum(min, 0), max: max === '' || max == null ? null : asNum(max, -1), label: (label || '').trim(), level: ['ok', 'warn', 'bad'].indexOf((level || '').trim()) >= 0 ? level.trim() : 'ok' };
  }).filter((x) => x && x.label);
  const def = {
    id: sid || '', title, sub: $('#scaleSub').value.trim(), tab, kind,
    max: asNum($('#scaleMax').value, 0), note: $('#scaleNote').value.trim(),
    items, levels, grades,
    inSummary: $('#chkSummary').checked, inTrend: $('#chkTrend').checked, inNarrative: $('#chkNarrative').checked
  };
  return { def: normalizeScaleDef(def) };
}

function saveScaleFromForm(sid) {
  const r = parseScaleForm(sid);
  if (r.err) return toast(r.err);
  const def = r.def;
  if (!def) return toast('当前题型至少需要一条目');
  const idx = state.customScales.findIndex((x) => x.id === def.id);
  if (idx >= 0) state.customScales[idx] = def; else state.customScales.push(def);
  scheduleSave(); closeModal(); renderView(); renderHead(); renderTabs();
  toast('量表「' + def.title + '」已保存');
}

function deleteScale(sid) {
  const d = state.customScales.find((x) => x.id === sid);
  if (!d) return;
  state.customScales = state.customScales.filter((x) => x.id !== sid);
  // 内置扩展量表被手动删除后记入 seedRemoved，刷新后不再自动补回
  if (String(sid).indexOf('u_seed_') === 0) state.seedRemoved = asArr(state.seedRemoved).concat(sid).filter((v, i, a) => a.indexOf(v) === i);
  // 同步清理各患者历次评估中该量表的残留取值，避免脏数据遗留
  state.patients.forEach((p) => {
    (p.assessments || []).forEach((a) => {
      if (isObj(a.custom) && a.custom[sid]) delete a.custom[sid];
    });
  });
  scheduleSave(); openScaleManager(); renderView(); renderHead();
  toast('已删除量表「' + d.title + '」');
}

function profileField(label, id, val, ph) {
  return '<label class="profile-field"><span>' + esc(label) + '</span><input id="' + id + '" value="' + esc(val) + '" placeholder="' + esc(ph) + '" autocomplete="off"></label>';
}
/* 设置：显示类、打印字号、默认收起等开关集中在这里，不改任何病历内容 */
function applySettings() {
  if (!isObj(state.settings)) state.settings = Object.assign({}, DEFAULT_SETTINGS);
  const st = state.settings;
  document.body.classList.toggle('ui-compact', !!st.compact);
  PRINT_TOKENS.size = st.printSize === '12' ? '12pt' : '10.5pt';
  PRINT_TOKENS.lineHeight = st.printSize === '12' ? 1.7 : 1.8;
}

function openSettings() {
  const st = isObj(state.settings) ? state.settings : (state.settings = Object.assign({}, DEFAULT_SETTINGS));
  const ck = (k, t, d) => '<label class="set-row"><div><b>' + t + '</b><span>' + d + '</span></div>' +
    '<input type="checkbox" data-pref="' + k + '"' + (st[k] ? ' checked' : '') + '></label>';
  $('#modal').innerHTML = '<div class="modal-head"><h3>设置</h3><button class="icon-btn x" data-action="close-modal">×</button></div>' +
    '<div class="modal-body">' +
    '<div class="set-group">显示</div>' +
    ck('railScore', '患者栏显示 Barthel 分数', '关掉后患者卡只留床号、诊断与状态，窄屏更清爽。') +
    ck('compact', '紧凑模式', '缩小章节与字段间距，一屏多看几行。') +
    ck('assistantCollapsed', '助手栏默认收起', '下次打开软件时右侧病历助手收起；点顶栏「助手」随时展开。') +
    '<label class="set-row"><div><b>Word 导出字号</b><span>五号适合常规病历；小四更大，适合给家属看的版本（浏览器打印不受影响）。</span></div>' +
      '<select data-pref="printSize"><option value="10.5"' + (String(st.printSize) === '10.5' ? ' selected' : '') + '>五号 10.5pt</option><option value="12"' + (String(st.printSize) === '12' ? ' selected' : '') + '>小四 12pt</option></select></label>' +
    '<div class="set-group">资料与数据</div>' +
    '<div class="set-actions">' +
      '<button class="btn small outline" data-action="profile-settings">医师与科室资料</button>' +
      '<button class="btn small outline" data-action="scale-manager">量表库管理</button>' +
      '<button class="btn small outline" data-action="data-manage">备份与恢复</button>' +
      '<button class="btn small outline" data-action="export-word">导出</button>' +
    '</div>' +
    '<p class="export-note">设置只影响本机显示与导出字号，不改动任何病历内容，随本地存档一起保存。</p>' +
    '</div><div class="modal-foot"><button class="btn outline" data-action="close-modal">关闭</button></div>';
  openModal();
}

function openProfileModal() {
  $('#modal').innerHTML = '<div class="modal-head"><h3>医师与科室资料</h3><button class="icon-btn x" data-action="close-profile">×</button></div>' +
    '<div class="modal-body">' +
    '<div class="asst-hint" style="padding:0 0 12px">用于病历抬头与签名落款，保存后随本地存储与备份一并迁移；上级审核医师与经治医师分开填写。</div>' +
    profileField('医院名称', 'profileHospital', state.hospital, '如：东营××医院') +
    profileField('科室', 'profileDept', state.dept, '如：康复医学科') +
    profileField('经治医师姓名', 'profileDoctor', state.doctor, '书写并记录病历的医师') +
    profileField('职称', 'profileTitle', state.doctorTitle, '如：主任医师 / 副主任医师 / 主治医师 / 住院医师') +
    profileField('上级审核医师', 'profileSupervisor', state.supervisor, '负责审核签名的上级医师（可留空）') +
    '</div><div class="modal-foot"><button class="btn outline" data-action="close-profile">关闭</button></div>';
  openModal();
}

function openDataModal() {
  $('#modal').innerHTML = '<div class="modal-head"><h3>数据备份与恢复</h3><button class="icon-btn x" data-action="close-modal">×</button></div>' +
    '<div class="modal-body">' +
    '<div class="asst-hint" style="padding:0 0 12px">病历数据保存在当前浏览器本地，清除缓存或更换电脑会丢失。建议定期导出备份文件，转移到其他设备时再恢复。</div>' +
    '<div class="backup-row"><div><b>导出备份</b><p>将全部患者病历下载为一个 JSON 文件</p></div>' +
    '<button class="btn small solid" data-action="export-backup">导出 JSON</button></div>' +
    '<div class="backup-row"><div><b>恢复备份</b><p>选择之前导出的 .json 备份文件</p></div>' +
    '<label class="btn small outline" for="backupFile">选择文件<input type="file" id="backupFile" accept=".json,application/json" hidden></label></div>' +
    '<div id="backupStatus"></div>' +
    '</div><div class="modal-foot"><button class="btn outline" data-action="close-modal">关闭</button></div>';
  openModal();
  $('#backupFile').addEventListener('change', onBackupFile);
}

function onBackupFile(e) {
  const f = e.target.files[0];
  if (!f) return;
  const status = $('#backupStatus');
  const rd = new FileReader();
  rd.onload = () => {
    let d;
    try { d = JSON.parse(rd.result); } catch (err) {
      return status.innerHTML = '<div class="asst-hint" style="color:var(--accent)">文件无法解析，请确认是备份 JSON 文件。</div>';
    }
    if (Array.isArray(d) && d.length) d = { patients: d };
    d = migrate(sanitizeBackup(d));
    if (!isObj(d) || !Array.isArray(d.patients) || !d.patients.length) {
      return status.innerHTML = '<div class="asst-hint" style="color:var(--accent)">格式不正确：文件里没有患者数据（patients）。</div>';
    }
    const bad = d.patients.filter((p) => !isObj(p) || !asStr(p.id).trim() || !asStr(p.name).trim()).length;
    if (bad) return status.innerHTML = '<div class="asst-hint" style="color:var(--accent)">格式不正确：有 ' + bad + ' 名患者缺少 id 或姓名。</div>';
    // dry-run 归一化：提前暴露数组/对象类型错误，避免导入到一半中断污染内存
    let probe;
    try {
      probe = d.patients.map((p) => { const c = clone(p); normalizePatient(c); return c; });
    } catch (err) {
      return status.innerHTML = '<div class="asst-hint" style="color:var(--accent)">备份结构异常，部分病历字段类型不符，已保留当前数据，请核对备份文件。</div>';
    }
    const dup = probe.length - new Set(probe.map((p) => p.id)).size;
    backupData = d;
    status.innerHTML = '<div class="backup-confirm"><b>识别到 ' + d.patients.length + ' 名患者' + (d.exportedAt ? '，备份时间 ' + esc(d.exportedAt) : '') + '。</b>' +
      (dup > 0 ? '<div style="margin-top:6px;color:var(--amber)">注意：备份内有 ' + dup + ' 个重复档案编号，合并时后者会覆盖前者。</div>' : '') +
      '<div style="display:flex;gap:8px;margin-top:8px"><button class="btn small solid" data-action="import-overwrite">覆盖导入</button>' +
      '<button class="btn small outline" data-action="import-merge">合并导入</button>' +
      '<span style="font-size:11px;color:var(--muted);align-self:center">覆盖 = 丢弃当前数据；合并 = 同编号档案以备份为准，其余保留</span></div></div>';
  };
  rd.readAsText(f);
}

function exportBackup() {
  persistNow();
  const data = backupPayloadObj();
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = '康复病历备份_' + todayISO() + '.json';
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 3000);
  toast('备份文件已导出');
}

/* 患者身份指纹：住院号是院内唯一标识，跨设备、跨备份都稳定；而 id 是随机生成的，换一台设备必然不同。
   只有填了住院号才做跨端认人；没填则退回 id 匹配，不冒险把两个同名患者合成一个。 */
function patientFingerprint(p) {
  if (!isObj(p)) return '';
  const mrn = asStr(p.mrn).trim().toUpperCase();
  if (!mrn) return '';
  return mrn + '|' + asStr(p.admitDate).trim();
}
/* 合并两份患者列表，三条规则按优先级走：
   1) id 相同 → 备份侧覆盖（同一份档案的正常更新）
   2) id 不同但住院号+入院日期相同 → 认定是同一患者，用备份内容覆盖本端记录，但保留本端 id
      （保留 id 是为了不让 currentId、草稿桶、病程引用、已建的量表关联断掉）
   3) 其余 → 追加为新患者
   返回统计，让界面能说清这次合并到底改了什么。 */
function mergePatientLists(cur, incoming) {
  const out = (Array.isArray(cur) ? cur : []).map((p) => (isObj(p) ? clone(p) : p));
  const byId = new Map();
  out.forEach((p, i) => { if (isObj(p) && p.id) byId.set(p.id, i); });
  const byFp = new Map();
  out.forEach((p, i) => { const fp = patientFingerprint(p); if (fp && !byFp.has(fp)) byFp.set(fp, i); });
  const stats = { added: 0, updated: 0, samePerson: 0 };
  (Array.isArray(incoming) ? incoming : []).forEach((raw) => {
    if (!isObj(raw)) return;
    const p = clone(raw);
    if (p.id && byId.has(p.id)) { out[byId.get(p.id)] = p; stats.updated++; return; }
    const fp = patientFingerprint(p);
    if (fp && byFp.has(fp)) {
      const i = byFp.get(fp);
      out[i] = Object.assign({}, p, { id: out[i].id });
      stats.samePerson++;
      return;
    }
    out.push(p);
    if (p.id) byId.set(p.id, out.length - 1);
    if (fp && !byFp.has(fp)) byFp.set(fp, out.length - 1);
    stats.added++;
  });
  return { list: out, stats };
}

function importBackup(overwrite) {
  if (!backupData) return;
  const d = migrate(sanitizeBackup(backupData)) || {};
  if (!Array.isArray(d.patients) || !d.patients.length) { backupData = null; toast('备份结构异常，已保留当前数据'); return; }
  const snapshot = clone({ patients: state.patients, currentId: state.currentId, customScales: state.customScales, doctor: state.doctor, hospital: state.hospital, dept: state.dept, doctorTitle: state.doctorTitle, supervisor: state.supervisor });
  let next;
  let mergeStats = null;
  try {
    if (overwrite) {
      next = clone(d.patients);
    } else {
      const merged = mergePatientLists(state.patients, d.patients);
      next = merged.list;
      mergeStats = merged.stats;
    }
    if (!Array.isArray(next) || !next.length) throw new Error('empty');
    next.forEach(normalizePatient);
    next.forEach(fillNoteAuthors);
    next = next.filter((p) => isObj(p) && asStr(p.name).trim());
    if (!next.length) throw new Error('no valid patient');
  } catch (err) {
    state.patients = snapshot.patients;
    state.currentId = snapshot.currentId;
    state.customScales = snapshot.customScales;
    state.doctor = snapshot.doctor;
    state.hospital = snapshot.hospital; state.dept = snapshot.dept; state.doctorTitle = snapshot.doctorTitle; state.supervisor = snapshot.supervisor;
    backupData = null;
    toast('备份结构异常，已保留当前数据');
    return;
  }
  state.patients = next;
  state.currentId = state.patients.some((p) => p.id === d.currentId) ? d.currentId : state.patients[0].id;
  if (d.doctor) state.doctor = d.doctor;
  if (d.hospital != null) state.hospital = asStr(d.hospital);
  if (d.dept != null) state.dept = asStr(d.dept) || '康复医学科';
  if (d.doctorTitle != null) state.doctorTitle = asStr(d.doctorTitle);
  if (d.supervisor != null) state.supervisor = asStr(d.supervisor);
  if (overwrite) {
    state.customScales = normalizeScaleDefs(d.customScales);
  } else {
    // 合并导入：按 id 并集，备份侧同 id 覆盖，避免本地已建量表被整表替换抹掉，也不产生重复卡
    const scaleMap = new Map();
    normalizeScaleDefs(state.customScales).forEach((x) => scaleMap.set(x.id, x));
    normalizeScaleDefs(d.customScales).forEach((x) => scaleMap.set(x.id, x));
    state.customScales = Array.from(scaleMap.values());
  }
  // 已删除内置量表记录：覆盖导入取备份侧，合并导入取并集，防止导入后种子复活
  const removedNext = overwrite
    ? asArr(d.seedRemoved).map(asStr)
    : asArr(state.seedRemoved).map(asStr).concat(asArr(d.seedRemoved).map(asStr));
  state.seedRemoved = Array.from(new Set(removedNext.filter(Boolean)));
  seedScales();
  state.tab = 'admit';
  state.draft = '';
  state.ddxDraft = '';
  state.reportDraft = '';
  state.reportParsed = [];
  state.parseDraft = '';
  state.compose = defaultCompose(P());
  state.drafts = {};   // 导入落地清空旧草稿桶，避免残留草稿串入新数据
  persistNow();
  closeModal();
  renderAll();
  const sameNote = (mergeStats && mergeStats.samePerson)
    ? '，其中 ' + mergeStats.samePerson + ' 条按住院号认出是同一患者，已合并为一份'
    : '';
  toast((overwrite ? '已覆盖导入' : '已合并导入') + ' ' + state.patients.length + ' 名患者' + sameNote);
  backupData = null;
}

/* ---------------- 打印 / 导出 ---------------- */
function printHtml(p) {
  const r = p.record, a = latest(p), b = a ? barthelTotal(a) : 0, bg = a ? bergTotal(a) : 0, ms = a ? mmseTotal(a) : 0;
  const tcm = r.tcm || {};
  const tcmParts = [['舌质', tcm.tongueBody], ['舌苔', tcm.tongueCoating], ['脉象', tcm.pulse], ['神色形态', tcm.look], ['声息气味', tcm.hearing], ['问诊', tcm.ask], ['辨证分型', tcm.pattern]]
    .filter((x) => (x[1] || '').trim()).map((x) => x[0] + '：' + esc(x[1]));
  const ddxItems = ((r.diffDx || {}).items || []).filter((x) => [x.d, x.support, x.against, x.advice].some((v) => (v || '').trim()));
  const ddxPrint = ddxItems.length ? printHead(9) + '<p>' + ddxItems.map((x, i) => {
    const lines = [(i + 1) + '. ' + esc(x.d || '—') + '：' + esc(x.support || '—')];
    if ((x.against || '').trim()) lines.push('　不支持：' + esc(x.against));
    if ((x.advice || '').trim()) {
      lines.push('　建议检查：' + esc(x.advice));
      const ev = auxEvidenceFor(x.advice, r.auxBoxes);
      if (ev) lines.push('　现有结果（' + esc(ev.label) + '）：' + esc(ev.text));
    }
    return lines.join('<br>');
  }).join('<br>') + '</p>' : '';
  const adv = (p.discharge.advice || []).filter((_, i) => (p.discharge.checked || []).indexOf(i) >= 0);
  const mmtTable = MMT_GROUPS.map((g) => {
    const row = (a && a.mmt[g]) || [0, 0];
    return '<tr><td>' + g + '</td><td>' + row[0] + ' 级</td><td>' + row[1] + ' 级</td></tr>';
  }).join('');
  const planItems = Array.isArray(r.planItems) ? r.planItems.filter((it) => it && (it.name || '').trim()) : [];
  const planItemsHtml = planItems.length ? '<table><thead><tr><th>治疗项目</th><th>频次</th><th>时长(min)</th><th>执行治疗师</th></tr></thead><tbody>' +
    planItems.map((it) => '<tr><td>' + esc(it.name || '—') + '</td><td>' + esc(it.frequency || '—') + '</td><td>' + esc(it.duration || '—') + '</td><td>' + esc(it.therapist || '—') + '</td></tr>').join('') + '</tbody></table>' : '';
  const notes = p.notes.slice().sort((x, y) => (dateTs(x.date) - dateTs(y.date))).map((n) => '<p><b>' + esc(n.date) + '</b>　[' + esc(NOTE_TYPE_LABEL[n.type] || '日常病程') + ']　' + (n.author ? esc(n.author) + '　' : '') + esc(n.text) + ((n.adverse || '').trim() ? '<br>　不良事件：' + esc(n.adverse) : '') + '</p>').join('');
  const customPrint = a ? state.customScales.filter((d) => (d.inSummary || d.inNarrative) && hasCustomValue(a, d)).map((d) => {
    const v = scaleTotal(a, d), g = scaleGrade(d, v);
    return esc(d.title) + ' ' + v + (d.max ? '/' + d.max : ' 分') + (g.label ? '（' + esc(g.label) + '）' : '');
  }).join('；') : '';
  const sheetTitle = (state.hospital ? esc(state.hospital) + '　' : '') + esc(state.dept || '康复医学科') + '病历';
  return '<div class="print-sheet"><h1>' + sheetTitle + '</h1><div class="psub">康复病历工作台生成 · ' + todayISO() + '</div>' +
    '<div class="pinfo"><span>姓名：' + esc(p.name) + '</span><span>性别：' + esc(p.gender) + '</span><span>年龄：' + p.age + ' 岁</span><span>床号：' + esc(p.bed) + '</span>' +
    '<span>住院号：' + esc(p.mrn) + '</span><span>入院：' + esc(p.admitDate) + '</span><span>状态：' + esc(p.status) + '</span><span>患侧：' + esc(p.side || '—') + '</span></div>' +
    printHead(0) + '<p data-edit="record.chief">' + esc(r.chief || '—') + '</p>' +
    printHead(1) + '<p data-edit="record.present">' + esc(r.present || '—') + '</p>' +
    printHead(2) + '<p>' + esc([r.past, r.personal, r.family, r.allergy].filter(Boolean).join('　') || '—') + '</p>' +
    printHead(3) + '<p>T ' + esc(r.vitals.t || '—') + ' ℃　P ' + esc(r.vitals.p || '—') + ' 次/分　R ' + esc(r.vitals.r || '—') + ' 次/分　BP ' + esc(r.vitals.bp || '—') + ' mmHg　SpO₂ ' + esc(r.vitals.spo2 || '—') + '%。</p><p data-edit="record.exam">' + esc(r.exam || '') + '</p>' +
    printHead(4) + '<p data-edit="record.neuro">' + esc(r.neuro || '—') + '</p>' +
    printHead(5) + '<p data-edit="record.aux">' + esc(r.aux || '—') + '</p>' +
    printHead(6) + '<p>' + (tcmParts.length ? tcmParts.join('；') + '。' : '—') + '</p>' +
    (a ? printHead(7, '（' + esc(a.date) + '）') + '<p>' + assessSummary(a) + '</p>' +
      (isTouched(a, 'mmt') ? '<table><thead><tr><th>肌群</th><th>左侧 MMT</th><th>右侧 MMT</th></tr></thead><tbody>' + mmtTable + '</tbody></table>' : '') : '') +
    printHead(8) + '<p>' + (r.diagnoses.map((d, i) => (i + 1) + '. ' + esc(d)).join('　') || '—') + '</p>' +
    ddxPrint +
    printHead(10) + '<p>问题：' + (r.problems.map(esc).join('；') || '—') + '</p><p><span class="inline-label">短期目标：</span><span data-edit="record.goalsShort">' + esc(r.goalsShort || '—') + '</span></p><p><span class="inline-label">长期目标：</span><span data-edit="record.goalsLong">' + esc(r.goalsLong || '—') + '</span></p>' +
    printHead(11) + '<p data-edit="record.plan">' + esc(r.plan || '—') + '</p>' + planItemsHtml +
    (notes ? printHead(12) + notes : '') +
    (adv.length ? printHead(13) + '<p>' + adv.map((x, i) => (i + 1) + '. ' + esc(x)).join('<br>') + '</p>' : '') +
    '<div class="signrow"><div class="psign">记录医师：' + esc(doctorLabel() || '—') + '</div><div class="psign">审核医师：' + esc(state.supervisor || '—') + '</div></div></div>';
}

function doPrint() {
  const p = P();
  if (!p) { toast('先选一位患者再打印'); return; }
  $('#printRoot').innerHTML = printHtml(p);
  setTimeout(() => window.print(), 60);
}

/* ---------------- 导出：多格式，尽量保留原排版 ---------------- */
function collectCss() {
  return Array.prototype.map.call(document.querySelectorAll('style'), (s) => s.textContent).join('\n');
}
/* Word / 第三方阅读器不认 CSS 变量：导出前把 var(--x) 全部换成当前实际值，排版才不会散架 */
function collectCssForDoc() {
  let css = collectCss();
  const rs = getComputedStyle(document.documentElement);
  const get = (n) => rs.getPropertyValue('--' + n).trim();
  css = css.replace(/var\(--([\w-]+)\s*,\s*([^)]+)\)/g, (m, n, fb) => get(n) || fb.trim());
  css = css.replace(/var\(--([\w-]+)\)/g, (m, n) => get(n) || m);
  /* 匿名 @page（屏幕打印用）与导出的 A4 具名页面设置会打架，导出稿里只留 WordSection1 那一份 */
  css = css.replace(/@page\s*([^{]*)\{([^}]*)\}/g, (m, sel, body) => (/WordSection1/.test(sel) ? m : ''));
  return css;
}
function downloadText(name, text, mime) {
  const blob = new Blob([text], { type: mime || 'text/plain;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = name;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 3000);
}
/* 单份/多份病历的网页版：直接内嵌本程序样式，表格、分节线、签名下划线原样保留 */
function caseHtmlDoc(body, title) {
  const css = collectCss();
  const extra = '\n.doc-wrap{background:#f2eee5;min-height:100vh;padding:22px 10px}'
    + '\n.doc-wrap .print-sheet{width:210mm;max-width:100%;margin:0 auto;background:#fff;box-shadow:0 2px 12px rgba(0,0,0,.10);box-sizing:border-box}'
    + '\n.doc-wrap .print-sheet + .print-sheet{page-break-before:always}'
    + '\n@media print{body{background:#fff}.doc-wrap{background:#fff;padding:0}.doc-wrap .print-sheet{width:auto;box-shadow:none;margin:0}}';
  return '<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><title>' + esc(title) + '</title><style>'
    + css + extra + '</style></head><body><div class="doc-wrap">' + body + '</div></body></html>';
}
/* 纯文本：用真实渲染后的 innerText 取文字，保留章节换行与表格列的分隔，去掉装饰符号 */
function casePlainText(p) {
  const d = document.createElement('div');
  d.className = 'print-sheet';
  d.style.cssText = 'position:fixed;left:-10000px;top:0;width:760px;background:#fff;color:#000';
  d.innerHTML = printHtml(p);
  document.body.appendChild(d);
  let t = (d.innerText || d.textContent || '');
  d.remove();
  return t.replace(/\r/g, '').replace(/[ \t]+/g, ' ').replace(/\n{3,}/g, '\n\n').trim() + '\n';
}
function exportCaseHtml() {
  const p = P();
  if (!p) { toast('先选一位患者再导出'); return; }
  downloadText('康复病历_' + safeFileName(p.name) + '_' + todayISO() + '.html', caseHtmlDoc(printHtml(p), '康复病历_' + p.name), 'text/html;charset=utf-8');
  closeModal();
  toast('已导出网页版病历，双击文件即可打开');
}
function exportCaseTxt() {
  const p = P();
  if (!p) { toast('先选一位患者再导出'); return; }
  downloadText('康复病历_' + safeFileName(p.name) + '_' + todayISO() + '.txt', '\ufeff' + casePlainText(p), 'text/plain;charset=utf-8');
  closeModal();
  toast('已导出纯文本，可直接粘贴到别的系统');
}
function exportAllHtml() {
  const list = state.patients || [];
  if (!list.length) { toast('还没有患者可导出'); return; }
  const body = list.map((p) => printHtml(p)).join('\n');
  downloadText('康复病历_全部患者_' + todayISO() + '.html', caseHtmlDoc(body, '康复病历（全部患者）'), 'text/html;charset=utf-8');
  closeModal();
  toast('已导出 ' + list.length + ' 位患者的合订本');
}
/* 患者清单：Excel 直接打开，做交班表、科室台账、医保自查底表 */
function exportCsv() {
  const list = state.patients || [];
  if (!list.length) { toast('还没有患者可导出'); return; }
  // 换行会把一行拆成两行、整表错列：先把 \r\n 压成空格，再转义引号
  const cell = (v) => '"' + String(v == null ? '' : v).replace(/[\r\n]+/g, ' ').replace(/"/g, '""') + '"';
  const head = ['床号', '姓名', '性别', '年龄', '住院号', '状态', '主要诊断', '患侧', '入院日期', '住院天数', '最近评定', '评定次数', '病程条数', '主管医师'];
  const rows = [head.map(cell).join(',')];
  list.forEach((p) => {
    const a = latest(p);
    let sum = '';
    try { sum = a ? assessSummary(a) : ''; } catch (e) { sum = ''; }
    rows.push([
      p.bed, p.name, p.gender, p.age, p.mrn, p.status, p.diagShort, p.side,
      p.admitDate, daysBetween(p.admitDate), sum,
      (p.assessments || []).length, (p.notes || []).length, doctorLabel()
    ].map(cell).join(','));
  });
  downloadText('患者清单_' + todayISO() + '.csv', '\ufeff' + rows.join('\r\n'), 'text/csv;charset=utf-8');
  closeModal();
  toast('已导出 ' + list.length + ' 位患者的清单，Excel 可直接打开');
}

function exportReportHtml() {
  if (!(state.reportParsed || []).length) { toast('暂无可导出的解读稿'); return; }
  const p = P();
  const head = '<h1 style="font-size:16pt;text-align:center;letter-spacing:4px">检验检查报告解读</h1>'
    + '<p style="font-size:10pt;color:#555">患者：' + esc(p.name) + '　' + esc(p.gender) + '　' + p.age + ' 岁　生成日期：' + todayISO() + '</p>'
    + '<p style="font-size:9pt;color:#777">说明：本稿为本地离线整理的指标对照与健康提示，不构成诊断结论、治疗方案或用药建议；异常项请结合症状、病史并咨询相应专科医生，最终以报告单标注与医生判断为准。</p>';
  const body = '<div class="print-sheet" style="padding:18mm 14mm;box-sizing:border-box">' + head + reportHtml() + '</div>';
  downloadText('报告解读_' + safeFileName(p.name) + '_' + todayISO() + '.html', caseHtmlDoc(body, '报告解读_' + p.name), 'text/html;charset=utf-8');
  closeModal();
  toast('解读稿已导出网页版');
}
function exportMenu() {
  const p = P();
  if (!p) { toast('先选一位患者再导出'); return; }
  const hasReport = (state.reportParsed || []).length > 0;
  const row = (a, t, s) => '<button class="btn outline" data-action="' + a + '"><b>' + t + '</b><span>' + s + '</span></button>';
  $('#modal').innerHTML = '<div class="modal-head"><h3>导出</h3><button class="icon-btn x" data-action="close-modal">×</button></div>'
    + '<div class="modal-body">'
    + '<p class="confirm-sub">当前患者：<b>' + esc(p.name) + '</b>。下面几种是同一份病历，差别在文件格式和拿去做啥。</p>'
    + '<div class="export-list">'
    + row('export-case-word', 'Word 文档（.doc）', '按打印稿排版导出，A4 页面、分节线、表格、签名栏都在；能在 Word 里继续改字、签字、留档。')
    + row('export-case-html', '网页文件（.html）', '保真度最高，双击用浏览器打开，和屏幕上一模一样；也能直接打印。')
    + row('print-pdf', 'PDF（打印后另存）', 'A4 版面，和纸质打印完全一致；在打印窗口里把"目标"选成"另存为 PDF"即可。')
    + row('export-case-txt', '纯文本（.txt）', '只留文字与分段，方便粘到 HIS、微信或别的系统，不带排版。')
    + '<div class="export-sep">全科</div>'
    + row('export-all-html', '全部患者合订本（.html）', '一份文件装下所有病人，每位一页，适合整科存档或批量打印。')
    + row('export-csv', '患者清单（.csv）', '一行一位患者（床号/姓名/诊断/入院天数/最近评定），Excel 直接打开，可做交班表、台账、医保核对。')
    + row('export-report-word', '报告解读 Word（.doc）', hasReport ? '当前报告解读稿单独导成 Word，给家属看更清楚。' : '这位患者还没做报告解读，点了会提示先解读。')
    + row('export-report-html', '报告解读 网页（.html）', hasReport ? '解读稿网页版，手机也能打开。' : '这位患者还没做报告解读，点了会提示先解读。')
    + row('export-backup', '完整备份（.json）', '所有患者与设置的原始数据，换电脑时用它恢复；别的格式恢复不了。')
    + '</div><p class="export-note">要"看得见的原样"：网页与 PDF 最稳，Word 次之（个别字体可能被替换）；要文字进别的系统用 .txt；要 Excel 算数据用 .csv。</p></div>'
    + '<div class="modal-foot"><button class="btn outline" data-action="close-modal">关闭</button></div>';
  openModal();
}

function wordDocHtml(p) {
  const tk = PRINT_TOKENS;
  let body = printHtml(p);
  /* Word 不认 grid / flex：信息栏、签名栏落地成表格，避免在 Word 里挤成一行或被截断 */
  body = body.replace(/<div class="pinfo">([\s\S]*?)<\/div>/, (m, inner) => {
    const cells = [];
    inner.replace(/<span>([\s\S]*?)<\/span>/g, (mm, t) => { cells.push(t); return ''; });
    let rows = '';
    for (let i = 0; i < cells.length; i += 4) {
      rows += '<tr>' + [0, 1, 2, 3].map((j) => '<td width="25%" style="width:25%">' + (cells[i + j] == null ? '' : cells[i + j]) + '</td>').join('') + '</tr>';
    }
    return '<table class="pinfo-t"><tbody>' + rows + '</tbody></table>';
  });
  /* 签名栏：按位置切，不用嵌套 div 正则（会吞掉第二个签名格） */
  const signStart = '<div class="signrow">';
  const signAt = body.indexOf(signStart);
  if (signAt >= 0) {
    const before = body.slice(0, signAt);
    const rest = body.slice(signAt + signStart.length).replace(/<\/div><\/div>\s*$/, '');
    const tds = [];
    rest.replace(/<div class="psign">([\s\S]*?)<\/div>/g, (mm, t) => { tds.push(t); return ''; });
    body = before + '<table class="sign-t" width="100%"><tbody><tr>' + tds.map((t) => '<td width="50%" style="width:50%">' + t + '</td>').join('') + '</tr></tbody></table></div>';
  }
  /* Word / WPS 对 CSS 边框支持不稳：普通数据表补 HTML 边框属性与内联样式，保证表格线可见 */
  body = body.replace(/<table>([\s\S]*?)<\/table>/g, (m, inner) => {
    const firstRow = (inner.match(/<tr>([\s\S]*?)<\/tr>/) || [, ''])[1];
    const n = (firstRow.match(/<t[hd][\s>]/g) || []).length || 1;
    const w = Math.floor(100 / n);
    const styled = inner.replace(/<(th|td)([^>]*)>/g, (mm, tag, attrs) => {
      if (/width=/.test(attrs)) return mm;
      return '<' + tag + attrs + ' width="' + w + '%" style="border:1px solid #666;padding:2pt 4pt;width:' + w + '%">';
    });
    return '<table border="1" width="100%" cellspacing="0" cellpadding="0" style="border-collapse:collapse;width:100%;table-layout:fixed">' + styled + '</table>';
  });
  /* Word 对 pre-wrap 支持不稳：正文换行直接写成 <br>，段落不再依赖 white-space */
  body = body.replace(/\n/g, '<br>');
  const css = '@page WordSection1{size:21cm 29.7cm;margin:1.7cm 1.5cm 1.6cm 1.5cm;mso-page-orientation:portrait;mso-header-margin:1cm;mso-footer-margin:1cm}'
    + 'div.WordSection1{page:WordSection1}'
    + 'body{margin:0;background:#fff;color:#000;font-family:SimSun,"宋体",serif;font-size:' + tk.size + ';line-height:' + tk.lineHeight + '}'
    + 'p{margin:0 0 2mm;text-align:left}'
    + 'h1{margin:0 0 2mm;font-size:' + tk.h1Size + ';text-align:center;font-family:SimHei,"黑体",SimSun;letter-spacing:6pt;font-weight:600}'
    + '.psub{margin:0 0 5mm;text-align:center;font-size:9pt;color:#555}'
    + 'h2{margin:4mm 0 1.5mm;font-size:' + tk.h2Size + ';font-family:SimHei,"黑体",SimSun;font-weight:600}'
    + 'table{border-collapse:collapse;width:100%;margin:0 0 3mm}'
    + 'th,td{border:0.5pt solid #666;padding:1.2mm 2mm;font-size:' + tk.tableSize + ';vertical-align:top;text-align:left}'
    + 'th{background:#f2f2f2;font-weight:600}'
    + '.pinfo-t{margin:0 0 4mm}.pinfo-t td{border:0;padding:0 0 1mm;font-size:10.5pt}'
    + '.sign-t{margin-top:8mm;width:100%}.sign-t td{border:0;padding:0;text-align:right;font-size:10.5pt;width:50%}'
    + '.inline-label{font-weight:600}';
  /* 国内 Word / WPS 对 <meta charset> 识别不稳，必须给 http-equiv；再加 mso 的打印视图声明 */
  return '<html xmlns:o="urn:schemas-microsoft-com:office:office" xmlns:w="urn:schemas-microsoft-com:office:word" xmlns="http://www.w3.org/TR/REC-html40" lang="zh-CN">'
    + '<head><meta http-equiv="Content-Type" content="text/html; charset=utf-8">'
    + '<meta name="ProgId" content="Word.Document"><meta name="Generator" content="康复病历工作台">'
    + '<title>康复病历_' + esc(p.name) + '</title>'
    + '<!--[if gte mso 9]><xml><w:WordDocument><w:View>Print</w:View><w:Zoom>100</w:Zoom></w:WordDocument></xml><![endif]-->'
    + '<style>' + css + '</style></head><body><div class="WordSection1">' + body + '</div></body></html>';
}

function exportWord() {
  const p = P();
  persistNow();
  const html = wordDocHtml(p);
  const blob = new Blob(['\ufeff', html], { type: 'application/msword;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = '康复病历_' + safeFileName(p.name) + '_' + todayISO() + '.doc';
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 3000);
  toast('已导出 Word 文档：A4 版式，若 Word 提示"格式与扩展名不一致"，点"是"照常打开即可');
}

function exportReportWord() {
  if (!state.reportParsed.length) { toast('暂无可导出的解读稿'); return; }
  const p = P();
  const head = '<h1 style="font-size:16pt;text-align:center;letter-spacing:4px">检验检查报告解读</h1>' +
    '<p style="font-size:10pt;color:#555">患者：' + esc(p.name) + '　' + esc(p.gender) + '　' + p.age + ' 岁　生成日期：' + todayISO() + '</p>' +
    '<p style="font-size:9pt;color:#777">说明：本稿为本地离线整理的指标对照与健康提示，不构成诊断结论、治疗方案或用药建议；异常项请结合症状、病史并咨询相应专科医生，最终以报告单标注与医生判断为准。</p>';
  const pageCss = '@page WordSection1{size:21cm 29.7cm;margin:1.7cm 1.5cm 1.6cm 1.5cm;mso-page-orientation:portrait}'
    + 'div.WordSection1{page:WordSection1}'
    + 'body{background:#fff;margin:0;overflow:visible;height:auto}'
    + '.rp-table{min-width:0;width:100%}.rp-wrap,.table-wrap{overflow:visible}';
  const html = '<html xmlns:o="urn:schemas-microsoft-com:office:office" xmlns:w="urn:schemas-microsoft-com:office:word" xmlns="http://www.w3.org/TR/REC-html40"><head><meta charset="utf-8">' +
    '<title>报告解读_' + esc(p.name) + '</title><style>' + collectCssForDoc() + '\n' + pageCss + '</style></head>' +
    '<body><div class="WordSection1">' + head + reportHtml() + '</div></body></html>';
  const blob = new Blob(['\ufeff', html], { type: 'application/msword' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = '报告解读_' + safeFileName(p.name) + '_' + todayISO() + '.doc';
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 3000);
  toast('解读稿已导出 Word');
}

/* ---------------- 初始化 ---------------- */
function init() {
  loadState();
  applySettings();
  if (isObj(state.settings) && state.settings.assistantCollapsed) {
    state.collapsed = true;
    document.body.classList.add('assistant-collapsed');
    const sh = $('.shell'); if (sh) sh.classList.add('assistant-collapsed');
  }
  bindStatic();
  renderAll();
  const el = $('#saveState');
  if (!el) return;
  if (savePaused) {
    el.classList.add('fail');
    el.lastElementChild.textContent = '存档损坏 · 已暂停保存（点此处理）';
    el.title = '原始存档已另存留证，点击查看处理方式';
  } else if (conflictBlocked) {
    el.classList.add('fail');
    el.lastElementChild.textContent = '已停止保存 · 点此接管';
  } else {
    el.lastElementChild.textContent = '本地自动保存';
  }
  /* 启动完成标记：index.html 的兜底提示据此判断要不要报警、并撤掉提示条 */
  window.__appReady = true;
  const bg = document.getElementById('bootGuard');
  if (bg && bg.parentNode) bg.parentNode.removeChild(bg);
}
function bindStatic() {
  $('#patientSwitch').addEventListener('change', (e) => selectPatient(e.target.value));
  // 设置项：复选框 / 下拉改完立即生效并落盘，不需要重开页面
  document.addEventListener('change', (e) => {
    const el = e.target && e.target.closest ? e.target.closest('[data-pref]') : null;
    if (!el) return;
    const key = el.dataset.pref;
    if (!isObj(state.settings)) state.settings = Object.assign({}, DEFAULT_SETTINGS);
    state.settings[key] = el.type === 'checkbox' ? el.checked : el.value;
    applySettings();
    scheduleSave();
    renderAll();
    toast('设置已保存');
  });
  // 状态条在异常态下可点：存档损坏、多窗口冲突都从这里进处理面板
  const ss = $('#saveState');
  if (ss) ss.addEventListener('click', () => { if (savePaused || conflictBlocked) openSaveHelp(); });
  $('#scrim').addEventListener('click', closeModal);
  $('#modalWrap').addEventListener('click', (e) => { if (e.target === $('#modalWrap')) closeModal(); });
  // 页面隐藏或关闭前兜底落盘，避免 450ms 防抖窗口内的最后一次变更丢失
  window.addEventListener('pagehide', persistNow);
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden') persistNow(); });
  // 其他窗口改动同一存档时立即提示：不自动重载（会丢本窗口未落盘编辑），由用户决定导出或重载
  window.addEventListener('storage', (e) => {
    if (e.key !== LS_KEY) return;
    if (e.newValue === lastSeenRaw) return;
    const el = $('#saveState');
    if (el) { el.classList.remove('saving'); el.classList.add('fail'); el.lastElementChild.textContent = '另一标签页有改动，未保存'; }
    if (!conflictWarned) { conflictWarned = true; toast('检测到另一个标签页也开着这个工具并改动了数据。为避免互相覆盖，这边不再自动保存；请先导出备份，再刷新页面（按 F5）。'); }
  });
}

init();


