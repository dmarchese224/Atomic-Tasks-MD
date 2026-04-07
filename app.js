'use strict';

const state = {
  tasks: [],
  fileHandle: null,
  currentView: 'all',
  activeTag: null,
  searchQuery: '',
  editingTaskId: null,
  currentTheme: document.documentElement.getAttribute('data-theme') || (matchMedia('(prefers-color-scheme:dark)').matches ? 'dark' : 'light')
};

const $ = id => document.getElementById(id);
const $$ = sel => document.querySelectorAll(sel);
const isMobile = () => window.matchMedia('(max-width: 768px)').matches;

function esc(str=''){ return String(str).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;'); }
function showToast(msg, duration=2400){ const t=$('toast'); t.textContent=msg; t.classList.add('show'); setTimeout(()=>t.classList.remove('show'),duration); }
function openMobileSidebar(){ $('sidebar').classList.add('mobile-open'); $('mobileBackdrop').hidden=false; }
function closeMobileSidebar(){ $('sidebar').classList.remove('mobile-open'); $('mobileBackdrop').hidden=true; }
function toggleMobileSidebar(){ $('sidebar').classList.contains('mobile-open') ? closeMobileSidebar() : openMobileSidebar(); }
function toggleTheme(){ state.currentTheme = state.currentTheme==='dark' ? 'light' : 'dark'; document.documentElement.setAttribute('data-theme', state.currentTheme); }

function todayStr(){ return new Date().toISOString().slice(0,10); }
function normalizeTags(raw=''){ return raw.split(',').map(t=>t.trim().replace(/^#/,'')).filter(Boolean); }
function buildTaskLine(task){ const tags = task.tags.map(t=>`#${t.replace(/^#/,'')}`).join(' '); const due = task.due ? ` due:${task.due}` : ''; const time = task.time ? ` time:${task.time}` : ''; const notes = task.notes ? ` notes:${JSON.stringify(task.notes)}` : ''; return `- [${task.done?'x':' '}] ${task.text}${due}${time}${tags ? ' ' + tags : ''}${notes}`.trim(); }
function parseTaskLine(line, index){ const m = line.match(/^\s*- \[( |x|X)\]\s+(.*)$/); if(!m) return null; const done = m[1].toLowerCase()==='x'; const body = m[2]; const dueMatch = body.match(/(?:^|\s)due:(\d{4}-\d{2}-\d{2})(?=\s|$)/); const timeMatch = body.match(/(?:^|\s)time:(\d{2}:\d{2})(?=\s|$)/); const notesMatch = body.match(/(?:^|\s)notes:(.*)$/); const due = dueMatch ? dueMatch[1] : ''; const time = timeMatch ? timeMatch[1] : ''; const notes = notesMatch ? notesMatch[1].trim().replace(/^"|"$/g,'') : ''; const tags = [...body.matchAll(/(^|\s)#([a-zA-Z0-9_-]+)/g)].map(x=>x[2]); let text = body.replace(/(?:^|\s)due:\d{4}-\d{2}-\d{2}(?=\s|$)/g,'').replace(/(?:^|\s)time:\d{2}:\d{2}(?=\s|$)/g,'').replace(/(?:^|\s)notes:.*$/g,'').replace(/(^|\s)#[a-zA-Z0-9_-]+/g,'').replace(/\s+/g,' ').trim(); return { id:`task-${index}`, done, text, due, time, notes, tags, raw:line }; }
function dueClass(due){ if(!due) return ''; const today=todayStr(); if(due<today) return 'overdue'; if(due===today) return 'today'; return ''; }
function formatDue(task){ if(!task.due) return ''; return task.time ? `${task.due} ${task.time}` : task.due; }

async function openTaskFile(){
  if(!('showOpenFilePicker' in window)){ showToast('Use Chrome or Edge with File System Access support.',3500); return; }
  try{
    const [handle] = await window.showOpenFilePicker({
      multiple:false,
      types:[{ description:'Markdown files', accept:{ 'text/markdown':['.md','.markdown'], 'text/plain':['.txt'] } }]
    });
    state.fileHandle = handle;
    $('filePath').textContent = handle.name;
    await loadTaskFile();
    showToast(`Opened: ${handle.name}`);
  }catch(e){ if(e.name!=='AbortError') showToast('Could not open task file'); }
}

async function loadTaskFile(){
  if(!state.fileHandle) return;
  const file = await state.fileHandle.getFile();
  const text = await file.text();
  state.tasks = text.split(/\r?\n/).map((line, idx)=>parseTaskLine(line, idx)).filter(Boolean);
  renderAll();
}

async function saveTaskFile(){
  if(!state.fileHandle){ showToast('No task file selected yet.'); return; }
  const content = state.tasks.map(buildTaskLine).join('\n') + (state.tasks.length ? '\n' : '');
  const writable = await state.fileHandle.createWritable();
  await writable.write(content);
  await writable.close();
}

function filteredTasks(){
  let tasks = [...state.tasks];
  if(state.activeTag) tasks = tasks.filter(t=>t.tags.includes(state.activeTag));
  if(state.searchQuery.trim()){
    const q = state.searchQuery.toLowerCase();
    tasks = tasks.filter(t => t.text.toLowerCase().includes(q) || t.tags.some(tag=>tag.toLowerCase().includes(q)) || (t.due||'').includes(q) || (t.time||'').includes(q));
  }
  const today = todayStr();
  if(state.currentView==='today') tasks = tasks.filter(t=>!t.done && t.due===today);
  if(state.currentView==='upcoming') tasks = tasks.filter(t=>!t.done && t.due && t.due>today);
  if(state.currentView==='done') tasks = tasks.filter(t=>t.done);
  if(state.currentView==='all') tasks = tasks;
  return tasks;
}

function renderTaskList(targetId, tasks){
  const el = $(targetId); if(!el) return; el.innerHTML='';
  if(!tasks.length){ el.innerHTML = '<div class="search-empty">No tasks in this view.</div>'; return; }
  tasks.forEach(task=>{
    const row = document.createElement('div');
    row.className = `task-item ${task.done?'done':''}`;
    row.innerHTML = `
      <input class="task-check" type="checkbox" ${task.done?'checked':''} aria-label="Toggle task completion">
      <div class="task-main">
        <div class="task-text">${esc(task.text)}</div>
        <div class="task-meta">
          ${task.due ? `<span class="task-chip task-due ${dueClass(task.due)}">${esc(formatDue(task))}</span>` : ''}
          ${task.tags.map(tag=>`<span class="task-chip">#${esc(tag)}</span>`).join('')}
        </div>
      </div>
      <div class="task-actions">
        <button class="task-icon-btn" data-action="edit" aria-label="Edit task"><i data-lucide="pencil"></i></button>
        <button class="task-icon-btn" data-action="delete" aria-label="Delete task"><i data-lucide="trash-2"></i></button>
      </div>`;
    row.querySelector('.task-check').addEventListener('change', async()=>{ task.done = !task.done; await saveTaskFile(); renderAll(); });
    row.querySelector('[data-action="edit"]').addEventListener('click', ()=>openEditor(task.id));
    row.querySelector('[data-action="delete"]').addEventListener('click', async()=>{ state.tasks = state.tasks.filter(t=>t.id!==task.id); await saveTaskFile(); renderAll(); showToast('Task deleted'); });
    el.appendChild(row);
  });
  lucide.createIcons();
}

function renderTags(){
  const map={}; state.tasks.forEach(t=>t.tags.forEach(tag=>map[tag]=(map[tag]||0)+1));
  const list = $('tagList'); list.innerHTML='';
  Object.entries(map).sort().forEach(([tag,count])=>{
    const item=document.createElement('div');
    item.className='tag-list-item'+(state.activeTag===tag?' active':'');
    item.innerHTML=`<span>#${esc(tag)}</span><span class="tag-count">${count}</span>`;
    item.addEventListener('click', ()=>{ state.activeTag = state.activeTag===tag ? null : tag; renderAll(); if(isMobile()) closeMobileSidebar(); });
    list.appendChild(item);
  });
}

function updateCount(){ $('taskCount').textContent = `${state.tasks.length} task${state.tasks.length!==1?'s':''}`; }

function renderAll(){
  const all = filteredTasks();
  renderTaskList('taskList', state.currentView==='all' ? all : []);
  renderTaskList('todayList', state.currentView==='today' ? all : state.tasks.filter(t=>!t.done && t.due===todayStr() && (!state.activeTag || t.tags.includes(state.activeTag)) && (!state.searchQuery || t.text.toLowerCase().includes(state.searchQuery.toLowerCase()) || t.tags.join(' ').toLowerCase().includes(state.searchQuery.toLowerCase()))));
  renderTaskList('upcomingList', state.currentView==='upcoming' ? all : state.tasks.filter(t=>!t.done && t.due && t.due>todayStr() && (!state.activeTag || t.tags.includes(state.activeTag))));
  renderTaskList('doneList', state.currentView==='done' ? all : state.tasks.filter(t=>t.done && (!state.activeTag || t.tags.includes(state.activeTag))));
  renderTags(); updateCount();
  $('emptyState').classList.toggle('visible', state.tasks.length===0);
}

function switchView(view){
  state.currentView=view;
  $$('.view').forEach(v=>v.classList.remove('active'));
  const target = document.getElementById(`view-${view}`); if(target) target.classList.add('active');
  $$('.nav-item[data-view]').forEach(n=>n.classList.toggle('active', n.dataset.view===view));
  renderAll();
  if(isMobile()) closeMobileSidebar();
}

function updateTaskPreview(){
  const draft = { done:false, text:$('taskTextInput').value.trim(), due:$('taskDueInput').value, time:$('taskTimeInput').value, notes:$('taskNotesInput').value.trim(), tags:normalizeTags($('taskTagsInput').value) };
  $('taskRawPreview').value = draft.text ? buildTaskLine(draft) : '- [ ] Sample task due:2026-04-10 #school';
}

function openEditor(taskId=null){
  state.editingTaskId = taskId;
  const task = taskId ? state.tasks.find(t=>t.id===taskId) : null;
  $('editorTitle').textContent = task ? 'Edit Task' : 'New Task';
  $('taskTextInput').value = task ? task.text : '';
  $('taskDueInput').value = task ? task.due : '';
  $('taskTimeInput').value = task ? (task.time || '') : '';
  $('taskTagsInput').value = task ? task.tags.join(', ') : '';
  $('taskNotesInput').value = task ? (task.notes || '') : '';
  updateTaskPreview();
  $('editorOverlay').classList.add('open');
}

function closeEditor(){ $('editorOverlay').classList.remove('open'); }

async function saveTask(){
  const text = $('taskTextInput').value.trim();
  if(!text){ showToast('Please enter a task description'); return; }
  const due = $('taskDueInput').value;
  const time = $('taskTimeInput').value;
  const tags = normalizeTags($('taskTagsInput').value);
  if(state.editingTaskId){
    const task = state.tasks.find(t=>t.id===state.editingTaskId);
    task.text = text; task.due = due; task.time = time; task.notes = $('taskNotesInput').value.trim(); task.tags = tags;
  } else {
    state.tasks.unshift({ id:`task-${Date.now()}`, done:false, text, due, time, notes:$('taskNotesInput').value.trim(), tags });
  }
  await saveTaskFile();
  renderAll();
  closeEditor();
  showToast('Task saved');
}

function loadDemoTasks(){
  state.tasks = [
    { id:'demo-1', done:false, text:'Finish dissertation chapter outline', due:todayStr(), time:'09:00', notes:'Draft the literature review section before lunch.', tags:['school'] },
    { id:'demo-2', done:false, text:'Review fatigue article highlights', due:'2026-04-10', time:'14:30', notes:'Pull the two strongest quotes for the methods chapter.', tags:['research','school'] },
    { id:'demo-3', done:false, text:'Schedule dentist appointment', due:'2026-04-08', time:'11:15', notes:'Use the insurance card and book after work.', tags:['personal'] },
    { id:'demo-4', done:true, text:'Update Atomic Notes MD app', due:'2026-04-05', time:'18:00', notes:'Confirmed the sidebar and autocomplete changes.', tags:['projects'] }
  ];
  renderAll();
}

document.addEventListener('DOMContentLoaded', ()=>{
  lucide.createIcons();
  loadDemoTasks();

  $('mobileSidebarToggle').addEventListener('click', toggleMobileSidebar);
  $('mobileBackdrop').addEventListener('click', closeMobileSidebar);
  $('sidebarToggle').addEventListener('click', ()=> $('sidebar').classList.toggle('collapsed'));
  $$('.nav-item[data-view]').forEach(btn=>btn.addEventListener('click', ()=>switchView(btn.dataset.view)));

  $('newTaskBtn').addEventListener('click', ()=>{ if(isMobile()) closeMobileSidebar(); openEditor(); });
  [$('openFileBtn'), $('emptyOpenBtn'), $('settingsOpenBtn')].forEach(btn=>btn?.addEventListener('click', async()=>{ if(isMobile()) closeMobileSidebar(); await openTaskFile(); }));
  $('refreshBtn').addEventListener('click', ()=>loadTaskFile());
  $('themeToggle').addEventListener('click', toggleTheme);
  $('quickSearch').addEventListener('input', e=>{ state.searchQuery = e.target.value.trim(); renderAll(); });

  $('taskTextInput').addEventListener('input', updateTaskPreview);
  $('taskDueInput').addEventListener('input', updateTaskPreview);
  $('taskTimeInput').addEventListener('input', updateTaskPreview);
  $('taskNotesInput').addEventListener('input', updateTaskPreview);
  $('taskTagsInput').addEventListener('input', updateTaskPreview);
  $('closeEditor').addEventListener('click', closeEditor);
  $('saveTask').addEventListener('click', saveTask);
  $('editorOverlay').addEventListener('click', e=>{ if(e.target===$('editorOverlay')) closeEditor(); });

  let deferredPrompt;
  window.addEventListener('beforeinstallprompt', e=>{
    e.preventDefault(); deferredPrompt=e;
    if($('installBtn')) $('installBtn').style.display='flex';
    if($('installHint')) $('installHint').style.display='none';
  });
  if($('installBtn')) $('installBtn').addEventListener('click', async()=>{ if(!deferredPrompt) return; deferredPrompt.prompt(); await deferredPrompt.userChoice; deferredPrompt=null; });

  if('serviceWorker' in navigator){
    window.addEventListener('load', async()=>{
      const candidates = ['./sw.js','sw.js','/sw.js'];
      for(const candidate of candidates){
        try{
          const swUrl = new URL(candidate, window.location.href);
          const res = await fetch(swUrl.href, { method:'GET', cache:'no-store' });
          if(res.ok){
            await navigator.serviceWorker.register(swUrl.href, { scope:'./' });
            console.log('SW registered:', swUrl.href);
            break;
          }
        }catch(err){ console.warn('SW candidate failed:', candidate, err); }
      }
    });
  }

  document.addEventListener('keydown', e=>{
    if((e.ctrlKey||e.metaKey)&&e.key==='n'){ e.preventDefault(); openEditor(); }
    if((e.ctrlKey||e.metaKey)&&e.key==='s'&&$('editorOverlay').classList.contains('open')){ e.preventDefault(); saveTask(); }
    if(e.key==='Escape'){ if($('editorOverlay').classList.contains('open')) closeEditor(); else if(isMobile() && $('sidebar').classList.contains('mobile-open')) closeMobileSidebar(); }
  });

  window.addEventListener('resize', ()=>{ if(!isMobile()) closeMobileSidebar(); });
});
