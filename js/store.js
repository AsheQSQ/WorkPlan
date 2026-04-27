import { supabaseClient } from './services.js';
const { reactive, computed, nextTick } = Vue;

export const store = reactive({
    isRegisterMode: false, accessKey: null, userId: null, inputKey: '', inputPassword: '',
    isSyncing: 'idle', saveTimer: null, lastDataHash: '', isDarkMode: false,
    aiInput: '', chatHistory: [], showAiPanel: false,
    today: new Date().toISOString().split('T')[0], viewDate: new Date().toISOString().split('T')[0], now: new Date(), currentView: 'dashboard',
    groups: [], activeGroupId: 'all', tasks: [], templates: [], scheduledTasks: [], activeTask: null, modal: { show: false, isEdit: false, data: {} }, isAllExpanded: false,
    openEditors: [], baseZIndex: 100, dragState: { isDragging: false, index: -1, startX: 0, startY: 0, initialX: 0, initialY: 0 },
    localAccessMap: {}, statsStart: new Date().toISOString().split('T')[0], statsEnd: new Date().toISOString().split('T')[0], statsStatus: 'all', statsGroupId: 'all', statsRangeType: 'week', draggingIndex: null
});

export const getters = {
    syncStatus: computed(() => {
        if (store.isSyncing === 'syncing') return { text: '同步中...', class: 'bg-blue-50 dark:bg-blue-900/30 text-blue-600 dark:text-blue-400 border-blue-200 dark:border-blue-800', icon: 'ph ph-spinner animate-spin' };
        if (store.isSyncing === 'done') return { text: '已同步', class: 'bg-green-50 dark:bg-green-900/30 text-green-600 dark:text-green-400 border-green-200 dark:border-green-800', icon: 'ph-bold ph-check' };
        if (store.isSyncing === 'error') return { text: '同步失败', class: 'bg-red-50 dark:bg-red-900/30 text-red-600 dark:text-red-400 border-red-200 dark:border-red-800', icon: 'ph-bold ph-warning' };
        return { text: '就绪', class: 'bg-slate-50 dark:bg-slate-800 text-slate-400 dark:text-slate-500 border-slate-200 dark:border-slate-700', icon: 'ph ph-cloud' };
    }),
    dateInfo: computed(() => {
        const date = new Date(store.viewDate);
        return { date: date.toLocaleDateString('zh-CN', { month: 'long', day: 'numeric' }), week: date.toLocaleDateString('zh-CN', { weekday: 'long' }) };
    }),
    futurePreviews: computed(() => {
        if (store.viewDate <= store.today) return [];
        const targetDay = new Date(store.viewDate).getDay();
        let list = store.scheduledTasks.filter(s => s.enabled && s.repeatDays.includes(targetDay === 0 ? 7 : targetDay));
        if (store.activeGroupId !== 'all') list = list.filter(t => (t.groupId || '') === store.activeGroupId);
        return list.map(s => ({ ...s, id: 'preview_' + s.id, status: 'todo', isPreview: true }));
    }),
    activeTasks: computed(() => {
        const list = store.tasks.filter(t => {
            const taskDate = t.date.split('T')[0];
            if (t.status === 'done') return false;
            if (store.viewDate !== store.today && taskDate !== store.viewDate) return false;
            if (store.activeGroupId !== 'all' && (t.groupId || '') !== store.activeGroupId) return false;
            return true;
        });
        const pMap = { critical: 3, urgent: 2, normal: 1 };
        const sMap = { doing: 2, todo: 1 };
        return list.sort((a, b) => {
            const pDiff = pMap[b.priority] - pMap[a.priority]; if (pDiff !== 0) return pDiff;
            const aOver = actions.isOverdue(a) ? 1 : 0; const bOver = actions.isOverdue(b) ? 1 : 0; if (aOver !== bOver) return bOver - aOver;
            const sDiff = sMap[b.status] - sMap[a.status]; if (sDiff !== 0) return sDiff;
            return a.date > b.date ? 1 : -1;
        });
    }),
    completedTasks: computed(() => {
        return store.tasks.filter(t => {
            if (t.status !== 'done') return false;
            if (store.viewDate === store.today) {
                if (t.date.split('T')[0] !== store.today && !(t.completedDate && t.completedDate.split('T')[0] === store.today)) return false;
            } else { if (t.date.split('T')[0] !== store.viewDate) return false; }
            if (store.activeGroupId !== 'all' && (t.groupId || '') !== store.activeGroupId) return false;
            return true;
        });
    }),
    overdueCount: computed(() => store.tasks.filter(t => t.status !== 'done' && actions.isOverdue(t)).length),
    enabledScheduledCount: computed(() => store.scheduledTasks.filter(t => t.enabled).length),
    statsData: computed(() => {
        const start = store.statsStart; const end = store.statsEnd;
        let list = store.tasks.filter(t => { const d = t.date.split('T')[0]; return d >= start && d <= end; });
        if (store.statsStatus === 'incomplete') list = list.filter(t => t.status === 'todo' || t.status === 'doing');
        else if (store.statsStatus !== 'all') list = list.filter(t => t.status === store.statsStatus);
        if (store.statsGroupId !== 'all') list = list.filter(t => (t.groupId || '') === store.statsGroupId);
        list.sort((a, b) => new Date(b.date) - new Date(a.date));
        const total = list.length; const done = list.filter(t => t.status === 'done').length;
        const doing = list.filter(t => t.status === 'doing').length; const todo = list.filter(t => t.status === 'todo').length;
        const rate = total > 0 ? ((done / total) * 100).toFixed(1) : 0;
        return { total, done, doing, todo, rate, list };
    })
};

export const actions = {
    toggleTheme() { store.isDarkMode = !store.isDarkMode; },
    handlePopState(e) {
        let handled = false;
        if (store.openEditors.length > 0) { store.openEditors.pop(); handled = true; }
        else if (store.modal.show) { store.modal.show = false; handled = true; } 
        else if (store.showAiPanel) { store.showAiPanel = false; handled = true; } 
        else if (store.activeTask && window.innerWidth <= 768) { store.activeTask = null; handled = true; }
        if (handled) window.history.pushState('trap', null, '');
        else if (confirm('确定要退出应用吗？')) window.history.back();
        else window.history.pushState('trap', null, '');
    },
    async checkLocalFilesAccessibility() {
        try {
            const keys = await window.localforage.keys(); const keySet = new Set(keys);
            store.tasks.forEach(task => { if (task.attachments) task.attachments.forEach(doc => { if (doc.type === 'local_file') store.localAccessMap[doc.id] = keySet.has(doc.id); }); });
        } catch (error) { console.error("检测失败", error); }
    },
    async openAttachment(task, doc = null) {
        if (!doc) { actions.openMdEditor(task, null); return; }
        if (doc.type === 'richtext') actions.openMdEditor(task, doc);
        else if (doc.type === 'local_file') {
            try {
                const fileBlob = await window.localforage.getItem(doc.id);
                if (!fileBlob) return alert(`非本机上传文件，不可显示`);
                const url = URL.createObjectURL(fileBlob); const a = document.createElement('a'); a.href = url; a.download = doc.title; document.body.appendChild(a); a.click(); document.body.removeChild(a); URL.revokeObjectURL(url);
            } catch (error) { alert("文件读取失败"); }
        }
    },
    async handleLocalFileUpload(event) {
        const file = event.target.files[0]; if (!file) return;
        if (file.size > 50 * 1024 * 1024) { alert("文件过大！建议本地缓存单文件不要超过 50MB。"); event.target.value = ''; return; }
        const docId = 'local_' + Date.now() + Math.random().toString(36).substr(2, 4);
        const attachmentMeta = { id: docId, type: 'local_file', title: file.name, size: file.size, created_at: new Date().toISOString() };
        try {
            await window.localforage.setItem(docId, file);
            if (!store.activeTask.attachments) store.activeTask.attachments = [];
            store.activeTask.attachments.push(attachmentMeta);
            await supabaseClient.from('tasks').update({ attachments: store.activeTask.attachments }).eq('id', store.activeTask.id);
            actions.updateStatus(store.activeTask);
            await actions.checkLocalFilesAccessibility();
        } catch (error) { alert("文件保存失败！"); }
        event.target.value = '';
    },
    bringToFront(index) { store.baseZIndex++; store.openEditors[index].zIndex = store.baseZIndex; },
    startDrag(event, index) {
        actions.bringToFront(index); store.dragState.isDragging = true; store.dragState.index = index; store.dragState.startX = event.clientX; store.dragState.startY = event.clientY;
        store.dragState.initialX = store.openEditors[index].x; store.dragState.initialY = store.openEditors[index].y;
        document.addEventListener('mousemove', actions.onDrag); document.addEventListener('mouseup', actions.stopDrag);
    },
    onDrag(event) {
        if (!store.dragState.isDragging) return;
        const dx = event.clientX - store.dragState.startX; const dy = event.clientY - store.dragState.startY;
        store.openEditors[store.dragState.index].x = store.dragState.initialX + dx; store.openEditors[store.dragState.index].y = store.dragState.initialY + dy;
    },
    stopDrag() { store.dragState.isDragging = false; document.removeEventListener('mousemove', actions.onDrag); document.removeEventListener('mouseup', actions.stopDrag); },
    openMdEditor(task, doc = null) {
        if (!task.attachments) task.attachments = [];
        let newData = doc ? JSON.parse(JSON.stringify(doc)) : { id: 'doc_' + Date.now(), type: 'richtext', title: '', content: '', created_at: new Date().toISOString() };
        if (store.openEditors.find(e => e.data.id === newData.id)) return;
        store.baseZIndex++;
        store.openEditors.push({ data: newData, targetTask: task, quillInstance: null, x: 100 + (store.openEditors.length * 40), y: 60 + (store.openEditors.length * 40), zIndex: store.baseZIndex });
        const index = store.openEditors.length - 1;
        nextTick(() => {
            const containerId = '#quill-editor-' + newData.id;
            const quill = new window.Quill(containerId, { theme: 'snow', modules: { toolbar: [[{ 'size': ['small', false, 'large'] }], [{ 'color': [] }, { 'background': [] }], ['bold', 'italic', 'strike', 'underline'], [{ 'list': 'ordered'}, { 'list': 'bullet' }], ['clean']] }, placeholder: '记录内容...' });
            if (newData.content) quill.root.innerHTML = newData.content;
            store.openEditors[index].quillInstance = quill;
        });
    },
    async saveMdDoc(index) {
        const editor = store.openEditors[index]; const task = editor.targetTask; if (!task.attachments) task.attachments = [];
        editor.data.content = editor.quillInstance.root.innerHTML;
        const aIndex = task.attachments.findIndex(a => a.id === editor.data.id);
        if (aIndex > -1) task.attachments[aIndex] = JSON.parse(JSON.stringify(editor.data)); else task.attachments.push(JSON.parse(JSON.stringify(editor.data)));
        try { await supabaseClient.from('tasks').update({ attachments: task.attachments }).eq('id', task.id); } catch (err) {}
        actions.updateStatus(task); actions.closeMdEditor(index);
    },
    closeMdEditor(index) { store.openEditors.splice(index, 1); },
    async deleteAttachment(task, docId, docType) {
        if (confirm('确定要永久移除此文件吗？(不可恢复)')) {
            task.attachments = task.attachments.filter(a => a.id !== docId);
            try { if (docType === 'local_file') await window.localforage.removeItem(docId); await supabaseClient.from('tasks').update({ attachments: task.attachments }).eq('id', task.id); } catch(e) {}
            const taskIndex = store.tasks.findIndex(t => t.id === task.id); if (taskIndex > -1) store.tasks.splice(taskIndex, 1, task);
            await actions.checkLocalFilesAccessibility();
        }
    },
    generateDataHash() { return JSON.stringify({ t: store.tasks.map(({ expanded, ...rest }) => rest), tm: store.templates, s: store.scheduledTasks, g: store.groups }); },
    getGroupName(id) { if (!id) return '无'; const g = store.groups.find(x => x.id === id); return g ? g.name : '无'; },
    createGroup() { const name = prompt('请输入新工作组名称:'); if (name && name.trim()) { const newId = 'g_' + Date.now(); store.groups.push({ id: newId, name: name.trim(), user_id: store.userId }); store.activeGroupId = newId; } },
    deleteGroup(id) { if (confirm('确定删除该分组吗？此分组下的任务将被归为"无"分组。')) { store.groups = store.groups.filter(g => g.id !== id); store.activeGroupId = 'all'; store.tasks.forEach(t => { if (t.groupId === id) t.groupId = ''; }); store.templates.forEach(t => { if (t.groupId === id) t.groupId = ''; }); store.scheduledTasks.forEach(t => { if (t.groupId === id) t.groupId = ''; }); } },
    async handleAuth() {
        if (!store.inputKey.trim() || !store.inputPassword.trim()) return alert("账号和密码不能为空");
        store.isSyncing = 'syncing';
        try {
            if (store.isRegisterMode) {
                const { data, error } = await supabaseClient.rpc('register_user', { p_access_key: store.inputKey.trim(), p_password: store.inputPassword });
                if (error) throw new Error(error.message.includes('unique') ? '该账号已被注册' : error.message);
                store.userId = data; alert("注册成功！已为您自动登录。");
            } else {
                const { data, error } = await supabaseClient.rpc('verify_login', { p_access_key: store.inputKey.trim(), p_password: store.inputPassword });
                if (error) throw error; if (!data) return alert("账号或密码错误"); store.userId = data;
            }
            store.accessKey = store.inputKey.trim(); localStorage.setItem('planpro_access_key', store.accessKey); localStorage.setItem('planpro_user_id', store.userId);
            await actions.loadData();
        } catch (e) { alert("错误: " + e.message); store.isSyncing = 'error'; }
    },
    logout() { if (confirm("确定要退出当前账号吗？")) { localStorage.removeItem('planpro_access_key'); localStorage.removeItem('planpro_user_id'); store.accessKey = null; store.userId = null; store.inputKey = ''; store.inputPassword = ''; store.tasks = []; store.templates = []; store.scheduledTasks = []; store.groups = []; } },
    async loadData() {
        store.isSyncing = 'syncing';
        try {
            let groupsRes = { data: [] }; try { groupsRes = await supabaseClient.from('groups').select('*').eq('user_id', store.userId); } catch (e) {}
            const [tasksRes, templatesRes, scheduledRes] = await Promise.all([ supabaseClient.from('tasks').select('*').eq('user_id', store.userId), supabaseClient.from('templates').select('*').eq('user_id', store.userId), supabaseClient.from('scheduled_tasks').select('*').eq('user_id', store.userId) ]);
            store.groups = groupsRes.data || [];
            store.tasks = (tasksRes.data || []).map(t => ({ ...t, date: t.plan_date ? t.plan_date.substring(0, 16) : '', deadline: t.deadline ? t.deadline.substring(0, 16) : '', startTime: t.start_time ? t.start_time.substring(0, 16) : null, completedDate: t.completed_date ? t.completed_date.substring(0, 16) : null, isFromSchedule: t.is_from_schedule, groupId: t.group_id || '', attachments: t.attachments || [], expanded: false }));
            store.templates = (templatesRes.data || []).map(t => ({ ...t, groupId: t.group_id || '' }));
            store.scheduledTasks = (scheduledRes.data || []).map(s => ({ ...s, repeatDays: s.repeat_days || [], lastGeneratedDate: s.last_generated_date, groupId: s.group_id || '' }));
            store.lastDataHash = actions.generateDataHash();
            store.isSyncing = 'done'; setTimeout(() => { if (store.isSyncing === 'done') store.isSyncing = 'idle'; }, 2000);
            actions.checkScheduledTasks(); await actions.checkLocalFilesAccessibility();
        } catch (e) { store.isSyncing = 'error'; }
    },
    saveData() {
        if (!store.userId) return;
        const currentHash = actions.generateDataHash(); if (store.lastDataHash === currentHash) return; store.lastDataHash = currentHash;
        store.isSyncing = 'syncing'; if (store.saveTimer) clearTimeout(store.saveTimer);
        store.saveTimer = setTimeout(async () => {
            try {
                const dbTasks = store.tasks.map(t => ({ id: t.id, user_id: store.userId, title: t.title, status: t.status, priority: t.priority, plan_date: t.date || null, deadline: t.deadline || null, start_time: t.startTime || null, completed_date: t.completedDate || null, note: t.note || '', subtasks: t.subtasks || [], attachments: t.attachments || [], is_from_schedule: t.isFromSchedule || false, group_id: t.groupId || null, updated_at: new Date().toISOString() }));
                const dbTemplates = store.templates.map(t => ({ id: t.id, user_id: store.userId, title: t.title, priority: t.priority || 'normal', note: t.note || '', subtasks: t.subtasks || [], group_id: t.groupId || null }));
                const dbScheduled = store.scheduledTasks.map(s => ({ id: s.id, user_id: store.userId, title: s.title, enabled: s.enabled, repeat_days: s.repeatDays || [], priority: s.priority || 'normal', note: s.note || '', subtasks: s.subtasks || [], last_generated_date: s.lastGeneratedDate || null, group_id: s.groupId || null }));
                const dbGroups = store.groups.map(g => ({ id: g.id, user_id: store.userId, name: g.name }));
                const promises = [];
                if (dbTasks.length > 0) promises.push(supabaseClient.from('tasks').upsert(dbTasks));
                if (dbTemplates.length > 0) promises.push(supabaseClient.from('templates').upsert(dbTemplates));
                if (dbScheduled.length > 0) promises.push(supabaseClient.from('scheduled_tasks').upsert(dbScheduled));
                if (dbGroups.length > 0) { try { promises.push(supabaseClient.from('groups').upsert(dbGroups)); } catch(e) {} }
                await Promise.all(promises);
                store.isSyncing = 'done'; setTimeout(() => { if (store.isSyncing === 'done') store.isSyncing = 'idle'; }, 3000);
            } catch (error) { store.isSyncing = 'error'; }
        }, 1500);
    },
    async deleteTask(id) {
        if (confirm('确定删除？')) {
            try {
                if (store.currentView === 'dashboard') { store.tasks = store.tasks.filter(t => t.id !== id); await supabaseClient.from('tasks').delete().eq('id', id); }
                else if (store.currentView === 'templates') { store.templates = store.templates.filter(t => t.id !== id); await supabaseClient.from('templates').delete().eq('id', id); }
                else { store.scheduledTasks = store.scheduledTasks.filter(t => t.id !== id); await supabaseClient.from('scheduled_tasks').delete().eq('id', id); }
                if (store.activeTask?.id === id) store.activeTask = null;
            } catch(e) {}
        }
    },
    onScheduleToggle(sch) { if (sch.enabled) { const yesterday = new Date(store.now); yesterday.setDate(yesterday.getDate() - 1); sch.lastGeneratedDate = yesterday.toISOString().split('T')[0]; } },
    checkScheduledTasks() {
        const todayDate = new Date(store.today); let addedCount = 0;
        store.scheduledTasks.forEach(sch => {
            if (!sch.enabled) return;
            if (!sch.lastGeneratedDate) { const yesterday = new Date(todayDate); yesterday.setDate(yesterday.getDate() - 1); sch.lastGeneratedDate = yesterday.toISOString().split('T')[0]; }
            let checkDate = new Date(sch.lastGeneratedDate); checkDate.setDate(checkDate.getDate() + 1);
            while (checkDate <= todayDate) {
                const dayOfWeek = checkDate.getDay();
                if (sch.repeatDays.includes(dayOfWeek)) {
                    const taskTime = checkDate.toISOString().split('T')[0] + 'T09:00'; const newNote = `${taskTime} ${sch.note || ''}`.trim();
                    store.tasks.push({ id: Date.now() + Math.random().toString(36).substr(2, 5), title: sch.title, status: 'todo', priority: sch.priority, date: taskTime, deadline: '', note: newNote, subtasks: JSON.parse(JSON.stringify(sch.subtasks || [])), attachments: [], expanded: false, isFromSchedule: true, groupId: sch.groupId || '' });
                    addedCount++;
                }
                checkDate.setDate(checkDate.getDate() + 1);
            }
            sch.lastGeneratedDate = store.today;
        });
        if (addedCount > 0) actions.saveData();
    },
    setStatsRange(type) {
        store.statsRangeType = type; const d = new Date(); const y = d.getFullYear(); const m = d.getMonth(); const day = d.getDay() || 7;
        if (type === 'today') { store.statsStart = store.statsEnd = store.today; } else if (type === 'yesterday') { d.setDate(d.getDate() - 1); store.statsStart = store.statsEnd = d.toISOString().split('T')[0]; } else if (type === 'week') { d.setDate(d.getDate() - day + 1); store.statsStart = d.toISOString().split('T')[0]; d.setDate(d.getDate() + 6); store.statsEnd = d.toISOString().split('T')[0]; } else if (type === 'lastWeek') { d.setDate(d.getDate() - day - 6); store.statsStart = d.toISOString().split('T')[0]; d.setDate(d.getDate() + 6); store.statsEnd = d.toISOString().split('T')[0]; } else if (type === 'month') { store.statsStart = new Date(y, m, 1, 12).toISOString().split('T')[0]; store.statsEnd = new Date(y, m + 1, 0, 12).toISOString().split('T')[0]; } else if (type === 'lastMonth') { store.statsStart = new Date(y, m - 1, 1, 12).toISOString().split('T')[0]; store.statsEnd = new Date(y, m, 0, 12).toISOString().split('T')[0]; }
    },
    exportData() { const blob = new Blob([JSON.stringify({ tasks: store.tasks, templates: store.templates, scheduledTasks: store.scheduledTasks, groups: store.groups }, null, 2)], { type: "application/json" }); const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = `backup_${store.today}.json`; a.click(); },
    importData(event) { const file = event.target.files[0]; if (!file) return; const reader = new FileReader(); reader.onload = (e) => { try { const json = JSON.parse(e.target.result); if (json.tasks) store.tasks = json.tasks; if (json.templates) store.templates = json.templates; if (json.scheduledTasks) store.scheduledTasks = json.scheduledTasks; if(json.groups) store.groups = json.groups; alert("导入成功！(稍后会自动同步至云端)"); } catch { alert('无效文件'); } event.target.value = ''; }; reader.readAsText(file); },
    async importOldData(event) {
        const file = event.target.files[0]; if (!file) return;
        const reader = new FileReader(); reader.onload = async (e) => {
            try {
                const json = JSON.parse(e.target.result); let importCount = 0;
                if (json.tasks && Array.isArray(json.tasks)) { const existingIds = new Set(store.tasks.map(t => t.id)); const newTasks = json.tasks.filter(t => !existingIds.has(t.id)); store.tasks = [...store.tasks, ...newTasks]; importCount += newTasks.length; }
                if (json.templates && Array.isArray(json.templates)) { const existingIds = new Set(store.templates.map(t => t.id)); const newTmpls = json.templates.filter(t => !existingIds.has(t.id)); store.templates = [...store.templates, ...newTmpls]; importCount += newTmpls.length; }
                if (json.scheduledTasks && Array.isArray(json.scheduledTasks)) { const existingIds = new Set(store.scheduledTasks.map(t => t.id)); const newSch = json.scheduledTasks.filter(t => !existingIds.has(t.id)); store.scheduledTasks = [...store.scheduledTasks, ...newSch]; importCount += newSch.length; }
                if (importCount > 0) alert(`🎉 成功导入了 ${importCount} 条历史数据！系统将自动保存至云端。`); else alert('✅ 文件解析成功，但没有发现新数据。');
            } catch (err) { alert('文件解析失败。'); } event.target.value = '';
        }; reader.readAsText(file);
    },
    dragStart(i, e) { store.draggingIndex = i; },
    dragDrop(to) { const arr = store.modal.data.subtasks; const item = arr.splice(store.draggingIndex, 1)[0]; arr.splice(to, 0, item); },
    toggleSubtask(task, sub) {
        sub.status = sub.status === 'done' ? 'todo' : 'done';
        if (sub.status === 'done') { if (task.subtasks.every(s => s.status === 'done')) { task.status = 'done'; actions.updateStatus(task); } else if (task.status === 'todo') { task.status = 'doing'; actions.updateStatus(task); } } else { if (task.status === 'done') { task.status = 'doing'; actions.updateStatus(task); } }
    },
    updateStatus(task) {
        const nowIso = new Date(store.now.getTime() - (store.now.getTimezoneOffset() * 60000)).toISOString().slice(0, 16);
        if (task.status === 'doing') { if (!task.startTime) task.startTime = nowIso; if (!task.date) task.date = nowIso; task.completedDate = null; } else if (task.status === 'done') { if (!task.startTime) task.startTime = nowIso; if (!task.date) task.date = nowIso; task.completedDate = nowIso; if (task.subtasks) task.subtasks.forEach(s => s.status = 'done'); } else { task.startTime = null; task.completedDate = null; }
    },
    changeDate(off) { const d = new Date(store.viewDate); d.setDate(d.getDate() + off); store.viewDate = d.toISOString().split('T')[0]; store.activeTask = null; },
    resetToToday() { store.viewDate = store.today; actions.checkScheduledTasks(); },
    switchView(view) { store.currentView = view; store.activeTask = null; if (view === 'dashboard') { store.viewDate = store.today; actions.checkScheduledTasks(); } },
    toggleAiPanel() { store.showAiPanel = !store.showAiPanel; if (store.showAiPanel) { store.activeTask = null; } },
    selectTask(task) { store.showAiPanel = false; store.activeTask = task; },
    toggleAll() { store.isAllExpanded = !store.isAllExpanded; getters.activeTasks.value.forEach(t => t.expanded = store.isAllExpanded); },
    loadTemplate(e) { const t = store.templates.find(x => x.id === e.target.value); if (t) { store.modal.data.title = t.title; store.modal.data.priority = t.priority; store.modal.data.subtasks = JSON.parse(JSON.stringify(t.subtasks)); } e.target.value = ''; },
    openModal(task) {
        store.modal.show = true; store.modal.isEdit = !!task; const defaultGroupId = store.activeGroupId === 'all' ? '' : store.activeGroupId;
        store.modal.data = task ? JSON.parse(JSON.stringify(task)) : { id: Date.now().toString(), title: '', status: 'todo', priority: 'normal', date: store.currentView === 'dashboard' ? store.viewDate + 'T12:00' : store.today + 'T09:00', subtasks: [], repeatDays: [], groupId: defaultGroupId };
    },
    addModalSubtask() { const input = document.getElementById('newSubInput'); const v = input ? input.value.trim() : ''; if (v) { if (!store.modal.data.subtasks) store.modal.data.subtasks = []; store.modal.data.subtasks.push({ title: v, status: 'todo' }); if (input) input.value = ''; } },
    saveTask() { if (!store.modal.data.title) return; const d = store.modal.data; const arr = store.currentView === 'dashboard' ? store.tasks : (store.currentView === 'templates' ? store.templates : store.scheduledTasks); if (store.modal.isEdit) { const i = arr.findIndex(t => t.id === d.id); d.expanded = arr[i].expanded; arr[i] = d; if (store.activeTask?.id === d.id) store.activeTask = d; } else arr.push(d); store.modal.show = false; },
    addInlineSubtask(t, e) { if (e.target.value.trim()) { t.subtasks.push({ title: e.target.value, status: 'todo' }); e.target.value = ''; } },
    isOverdue(t) { if (!t.deadline) return false; const now = new Date(store.now.getTime() - (store.now.getTimezoneOffset() * 60000)).toISOString().slice(0, 16); return t.deadline < now; },
    getLatestNoteLine(n) { return n ? n.split('\n').filter(l => l.trim()).pop() : ''; },
    getStatusStyle(s) { return { 'todo': 'bg-slate-100 dark:bg-slate-700/50 text-slate-500 dark:text-slate-400', 'doing': 'bg-blue-50 dark:bg-blue-900/30 text-blue-600 dark:text-blue-400', 'done': 'bg-green-50 dark:bg-green-900/30 text-green-600 dark:text-green-400' }[s]; },
    getPriorityStyle(p) { return { 'normal': 'text-blue-500 dark:text-blue-400', 'urgent': 'text-orange-500 dark:text-orange-400', 'critical': 'text-red-500 dark:text-red-400' }[p]; },
    formatRepeatDays(d) { if (!d || !d.length) return ['无']; const m = { 1: '一', 2: '二', 3: '三', 4: '四', 5: '五', 6: '六', 0: '日' }; return d.sort((a, b) => (a === 0 ? 7 : a) - (b === 0 ? 7 : b)).map(x => '周' + m[x]); },
    formatTimeOnly(d) { return d && d.includes('T') ? d.split('T')[1] : ''; },
    formatDateTime(d) { return d ? d.replace('T', ' ') : ''; },
    getStatsStatusStyle(t) { return t.status === 'done' ? (t.deadline && t.completedDate > t.deadline ? 'bg-red-100 dark:bg-red-900/30 text-red-700 dark:text-red-400' : 'bg-green-100 dark:bg-green-900/30 text-green-700 dark:text-green-400') : (t.status === 'doing' ? 'bg-blue-100 dark:bg-blue-900/30 text-blue-700 dark:text-blue-400' : 'bg-slate-100 dark:bg-slate-700/50 text-slate-500 dark:text-slate-400'); },
    getStatsStatusLabel(t) { return t.status === 'done' ? (t.deadline && t.completedDate > t.deadline ? '超时完成' : '已完成') : { 'todo': '未开始', 'doing': '进行中' }[t.status]; },
    async sendAiMessage() {
        const text = store.aiInput.trim(); if (!text) return;
        store.chatHistory.push({ role: 'user', type: 'text', content: text }); store.aiInput = ''; store.chatHistory.push({ role: 'assistant', type: 'loading' });
        nextTick(() => actions.scrollToBottom());
        try { const result = await actions.analyzeAiIntent(text); store.chatHistory.pop(); if (result) { store.chatHistory.push({ role: 'assistant', type: 'task_card', data: result, confirmed: false }); } else { store.chatHistory.push({ role: 'assistant', type: 'text', content: 'AI 似乎没有理解，请尝试描述得更具体一点。' }); } } catch (error) { store.chatHistory.pop(); store.chatHistory.push({ role: 'assistant', type: 'text', content: `请求出错: ${error.message}` }); }
        nextTick(() => actions.scrollToBottom());
    },
    confirmAiTask(taskData, msgIndex) { store.tasks.push(taskData); store.chatHistory[msgIndex].confirmed = true; store.chatHistory.push({ role: 'assistant', type: 'text', content: `✅ 任务 "${taskData.title}" 已成功添加到列表！\n(注: 若未在看板显示，请检查任务日期或左上方分组是否匹配)` }); nextTick(() => actions.scrollToBottom()); },
    async analyzeAiIntent(userText) {
        const nowIso = new Date(new Date().getTime() - (new Date().getTimezoneOffset() * 60000)).toISOString().slice(0, 16);
        const systemInstructions = `你是一个任务管理助手。当前时间：${nowIso}。请严格遵守以下规则：根据用户的输入生成一个 JSON 对象。你必须且只能返回合法的纯 JSON 字符串，绝不能包含任何 markdown 代码块标记。格式必须严格为：{"title":"任务名", "date":"YYYY-MM-DDTHH:mm", "priority":"normal/urgent", "note":""}。重要警告：日期中的 T 是强制要求的，绝不能用空格或斜杠！`;
        const VERCEL_HOST = 'https://www.yuyuworkplan-pro.xyz'; let aiRawContent = "";
        try {
            const response = await fetch(`${VERCEL_HOST}/api/chat`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ message: `${systemInstructions}\n\n用户输入: ${userText}` }) });
            if (!response.ok) throw new Error(`API 响应错误: ${response.status}`);
            const data = await response.json(); aiRawContent = data.choices?.[0]?.message?.content || data.reply || data.response || "";
            if (!aiRawContent) throw new Error("API返回为空");
            let cleanJsonStr = aiRawContent.replace(/`{3}(?:json)?/gi, '').trim(); const jsonMatch = cleanJsonStr.match(/(\{[\s\S]*\}|\[[\s\S]*\])/); if (jsonMatch) cleanJsonStr = jsonMatch[0];
            let parsed; try { parsed = JSON.parse(cleanJsonStr); } catch (parseErr) { const fixedStr = cleanJsonStr.replace(/“|”/g, '"').replace(/'/g, '"').replace(/,\s*([\}\]])/g, '$1'); parsed = JSON.parse(fixedStr); }
            if (Array.isArray(parsed) && parsed.length > 0) parsed = parsed[0];
            let aiDate = parsed.date || store.today + "T09:00"; aiDate = aiDate.replace(' ', 'T').replace(/\//g, '-'); if (aiDate.length === 10) aiDate += "T09:00"; if (aiDate.length > 16) aiDate = aiDate.substring(0, 16);
            return { id: Date.now().toString() + Math.random().toString(36).substr(2, 5), title: parsed.title || "未命名任务", date: aiDate, status: 'todo', priority: parsed.priority || 'normal', subtasks: [], note: parsed.note || '', groupId: store.activeGroupId === 'all' ? '' : store.activeGroupId, expanded: false, deadline: '', startTime: null, completedDate: null, isFromSchedule: false };
        } catch (error) { throw new Error("AI 数据格式化失败，请重试或换个说法。"); }
    },
    scrollToBottom() { const c1 = document.getElementById('chatContainer'); const c2 = document.getElementById('chatContainerMobile'); if (c1) c1.scrollTop = c1.scrollHeight; if (c2) c2.scrollTop = c2.scrollHeight; }
};