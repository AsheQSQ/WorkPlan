// --- Supabase 配置 ---
const SUPABASE_URL = 'https://scjswpjktydojedqywxq.supabase.co';
const SUPABASE_KEY = 'sb_publishable_TSXrb7sbhV7l5hgqjC0KuA_dVdxmSpu';
const supabase = window.supabase.createClient(SUPABASE_URL, SUPABASE_KEY);

const { createApp } = Vue;

createApp({
    data() {
        return {
            // --- 登录相关 ---
            accessKey: null, // 当前登录的 Key
            inputKey: '',    // 输入框的 Key
            lastUpdatedAt: 0, // 本地记录的“最后同步时间戳”

            // --- 业务数据 ---
            today: new Date().toISOString().split('T')[0],
            viewDate: new Date().toISOString().split('T')[0],
            now: new Date(),
            currentView: 'dashboard', 
            tasks: [], templates: [], scheduledTasks: [], 
            activeTask: null, 
            modal: { show: false, isEdit: false, data: {} },
            isAllExpanded: false,
            statsStart: new Date().toISOString().split('T')[0],
            statsEnd: new Date().toISOString().split('T')[0],
            statsStatus: 'all',
            draggingIndex: null,
            saveTimer: null,
            isSyncing: 'idle' 
        }
    },
    computed: {
        // UI 显示部分
        syncStatus() {
            if (this.isSyncing === 'syncing') return { text: '正在同步...', class: 'bg-blue-50 text-blue-600 border-blue-200', icon: 'ph ph-spinner animate-spin' };
            if (this.isSyncing === 'done') return { text: '云端已同步', class: 'bg-green-50 text-green-600 border-green-200', icon: 'ph-bold ph-check' };
            if (this.isSyncing === 'error') return { text: '同步失败', class: 'bg-red-50 text-red-600 border-red-200', icon: 'ph-bold ph-warning' };
            return { text: '准备就绪', class: 'bg-slate-50 text-slate-400 border-slate-200', icon: 'ph ph-cloud' };
        },
        dateInfo() { const date = new Date(this.viewDate); return { date: date.toLocaleDateString('zh-CN', { month: 'long', day: 'numeric' }), week: date.toLocaleDateString('zh-CN', { weekday: 'long' }) }; },
        futurePreviews() {
            if (this.viewDate <= this.today) return [];
            const targetDay = new Date(this.viewDate).getDay(); 
            return this.scheduledTasks.filter(s => s.enabled && s.repeatDays.includes(targetDay === 0 ? 7 : targetDay)).map(s => ({ ...s, id: 'preview_' + s.id, status: 'todo', isPreview: true }));
        },
        activeTasks() {
            const list = this.tasks.filter(t => {
                const taskDate = t.date.split('T')[0];
                if (t.status === 'done') return false;
                if (this.viewDate === this.today) return taskDate <= this.today;
                else return taskDate === this.viewDate;
            });
            const pMap = { critical: 3, urgent: 2, normal: 1 };
            const sMap = { doing: 2, todo: 1 };
            return list.sort((a, b) => {
                const pDiff = pMap[b.priority] - pMap[a.priority];
                if (pDiff !== 0) return pDiff;
                const aOver = this.isOverdue(a) ? 1 : 0;
                const bOver = this.isOverdue(b) ? 1 : 0;
                if (aOver !== bOver) return bOver - aOver;
                const sDiff = sMap[b.status] - sMap[a.status];
                if (sDiff !== 0) return sDiff;
                if (a.date !== b.date) return a.date > b.date ? 1 : -1;
                return 0;
            });
        },
        completedTasks() { 
            return this.tasks.filter(t => {
                if (t.status !== 'done') return false;
                if(this.viewDate === this.today) return (t.date.split('T')[0] === this.today || (t.completedDate && t.completedDate.split('T')[0] === this.today));
                else return t.date.split('T')[0] === this.viewDate;
            }); 
        },
        overdueCount() { return this.tasks.filter(t => t.status !== 'done' && this.isOverdue(t)).length; },
        enabledScheduledCount() { return this.scheduledTasks.filter(t => t.enabled).length; },
        statsData() {
            const start = this.statsStart;
            const end = this.statsEnd;
            if(!start || !end) return { total:0, done:0, rate:0, onTime:0, avgDuration:'-', list:[] };
            let list = this.tasks.filter(t => { const d = t.date.split('T')[0]; return d >= start && d <= end; });
            if(this.statsStatus !== 'all') { list = list.filter(t => t.status === this.statsStatus); }
            list.sort((a,b) => new Date(b.date) - new Date(a.date));
            const total = list.length;
            const doneList = list.filter(t => t.status === 'done');
            const done = doneList.length;
            const doing = list.filter(t => t.status === 'doing').length;
            const todo = list.filter(t => t.status === 'todo').length;
            const rate = total > 0 ? ((done / total) * 100).toFixed(1) : 0;
            const onTime = doneList.filter(t => { if(!t.deadline || !t.completedDate) return true; return t.completedDate <= t.deadline; }).length;
            return { total, done, doing, todo, rate, onTime, list };
        }
    },
    
    // --- 生命周期 ---
    mounted() {
        // 1. 检查本地是否有 Access Key
        const savedKey = localStorage.getItem('planpro_access_key');
        if (savedKey) {
            this.accessKey = savedKey;
            this.loadData(); // 有 Key 才加载数据
        }
        
        // 2. 启动定时器
        this.checkScheduledTasks();
        this.setStatsRange('week');
        setInterval(() => { this.now = new Date(); if (this.currentView === 'dashboard' && this.viewDate === this.today) this.checkScheduledTasks(); }, 60000);
    },
    
    // --- 监听器 ---
    watch: {
        // 只有登录后，数据变动才触发保存
        tasks: { handler() { if(this.accessKey) this.saveData(); }, deep: true },
        templates: { handler() { if(this.accessKey) this.saveData(); }, deep: true },
        scheduledTasks: { handler() { if(this.accessKey) this.saveData(); }, deep: true }
    },

    methods: {
        // --- 登录系统 ---
        login() {
            if (!this.inputKey.trim()) return alert("Key 不能为空");
            this.accessKey = this.inputKey.trim();
            localStorage.setItem('planpro_access_key', this.accessKey);
            this.loadData();
        },
        generateKey() {
            this.inputKey = 'user_' + Math.random().toString(36).substr(2, 9);
        },
        logout() {
            if(confirm("确定要退出当前 Key 吗？\n(本地数据会清空，但云端数据还在，下次输入 Key 可找回)")) {
                localStorage.removeItem('planpro_access_key');
                localStorage.removeItem('planpro_final_tasks'); // 清理缓存
                this.accessKey = null;
                this.inputKey = '';
                this.tasks = []; this.templates = []; this.scheduledTasks = [];
            }
        },

        // --- 🔥 核心升级：智能加载数据 ---
        async loadData() {
            this.isSyncing = 'syncing';
            try {
                // 1. 先尝试读取本地缓存（为了秒开）
                const s = localStorage.getItem('planpro_final_tasks');
                const t = localStorage.getItem('planpro_final_templates');
                const st = localStorage.getItem('planpro_final_scheduled');
                if(s) this.tasks = JSON.parse(s);
                if(t) this.templates = JSON.parse(t);
                if(st) this.scheduledTasks = JSON.parse(st);

                // 2. 去云端对比数据
                console.log(`[${this.accessKey}] 正在检查云端版本...`);
                
                // 注意：这里多取了一个 updated_at 字段
                const { data, error } = await supabase
                    .from('user_data')
                    .select('content, updated_at')
                    .eq('my_key', this.accessKey)
                    .single();

                // 3. 智能判断
                if (data && data.content) {
                    const serverTime = data.updated_at || 0;
                    
                    // 如果云端时间 > 本地记录的最后时间，说明云端有新数据，必须覆盖
                    // (简单起见，这里每次都覆盖，保证多端一致性。如果想更极致省流量，可以把本地 lastUpdatedAt 存 localStorage 对比)
                    if (serverTime > this.lastUpdatedAt) {
                        const json = data.content;
                        if(json.tasks) this.tasks = json.tasks;
                        if(json.templates) this.templates = json.templates;
                        if(json.scheduledTasks) this.scheduledTasks = json.scheduledTasks;
                        
                        this.lastUpdatedAt = serverTime; // 更新本地时间戳
                        this.isSyncing = 'done';
                        console.log("云端数据更新，已同步");
                    } else {
                        console.log("本地数据已是最新");
                        this.isSyncing = 'idle';
                    }
                } else {
                    console.log("云端无数据，可能是新用户");
                    this.isSyncing = 'idle';
                    // 如果本地有数据（刚导入的），初始化云端
                    if(this.tasks.length > 0) this.saveData();
                }
            } catch (e) {
                console.error("加载异常:", e);
                this.isSyncing = 'error';
            }
        },

        // --- 🔥 核心升级：智能保存数据 (带冲突检测) ---
        saveData() {
            if (!this.accessKey) return;

            // 1. 本地立即保存 (缓存)
            localStorage.setItem('planpro_final_tasks', JSON.stringify(this.tasks)); 
            localStorage.setItem('planpro_final_templates', JSON.stringify(this.templates));
            localStorage.setItem('planpro_final_scheduled', JSON.stringify(this.scheduledTasks));

            // 2. 防抖 + 智能云端保存
            this.isSyncing = 'syncing';
            if (this.saveTimer) clearTimeout(this.saveTimer);

            this.saveTimer = setTimeout(async () => {
                const nowTimestamp = Date.now();
                
                // 准备数据
                const rawData = JSON.parse(JSON.stringify({
                    tasks: this.tasks,
                    templates: this.templates,
                    scheduledTasks: this.scheduledTasks
                }));

                // ⚠️ 冲突检测逻辑：在写入前，最好检查一下云端是不是已经被别人改了
                // 但为了简化代码（避免二次请求），我们直接用 updated_at 覆盖
                // 如果需要严格防冲突，这里应该先 select updated_at，比较后再 upsert
                
                const { error } = await supabase
                    .from('user_data')
                    .upsert(
                        { 
                            my_key: this.accessKey, // 现在的 Key 是动态的
                            content: rawData, 
                            updated_at: nowTimestamp // 写入当前时间戳
                        }, 
                        { onConflict: 'my_key' }
                    );

                if (error) {
                    console.error('云端保存失败:', error);
                    this.isSyncing = 'error';
                } else {
                    this.lastUpdatedAt = nowTimestamp; // 更新本地时间戳
                    this.isSyncing = 'done';
                    setTimeout(() => { if(this.isSyncing === 'done') this.isSyncing = 'idle'; }, 3000);
                }
            }, 2000);
        },
        
        // --- 删库跑路 (清空) ---
        handleClearData() {
            this.verifySuper(async () => {
                if (confirm(`⚠️ 警告：将永久删除 Key [${this.accessKey}] 下的所有数据！`)) {
                    // 1. 删云端
                    const { error } = await supabase.from('user_data').delete().eq('my_key', this.accessKey);
                    if (error) { alert("删除失败"); return; }
                    
                    // 2. 删本地
                    localStorage.removeItem('planpro_access_key');
                    localStorage.clear();
                    
                    alert("数据已清空，即将刷新");
                    location.reload();
                }
            });
        },

        // --- 其他原有业务逻辑 (保持不变) ---
        dragStart(index, event) { this.draggingIndex = index; event.dataTransfer.effectAllowed = 'move'; event.target.classList.add('dragging'); },
        dragEnd(event) { this.draggingIndex = null; event.target.classList.remove('dragging'); },
        dragDrop(toIndex) { const fromIndex = this.draggingIndex; if (fromIndex === null || fromIndex === toIndex) return; const list = this.modal.data.subtasks; const item = list.splice(fromIndex, 1)[0]; list.splice(toIndex, 0, item); },
        toggleSubtask(task, sub) { sub.status = sub.status === 'done' ? 'todo' : 'done'; if (sub.status === 'done' && task.status === 'todo') { task.status = 'doing'; this.updateStatus(task); } },
        updateStatus(task) { if (task.status === 'done' && task.subtasks && task.subtasks.length > 0) { task.subtasks.forEach(s => s.status = 'done'); } const nowIso = new Date(new Date().getTime() - (new Date().getTimezoneOffset() * 60000)).toISOString().slice(0,16); if (task.status === 'doing') { if (!task.startTime) task.startTime = nowIso; task.completedDate = null; } else if (task.status === 'done') { task.completedDate = nowIso; } else if (task.status === 'todo') { task.startTime = null; task.completedDate = null; } },
        setStatsRange(type) { const d = new Date(); if (type === 'yesterday') { d.setDate(d.getDate() - 1); this.statsStart = d.toISOString().split('T')[0]; this.statsEnd = d.toISOString().split('T')[0]; } else if (type === 'week') { const day = d.getDay() || 7; if(day !== 1) d.setHours(-24 * (day - 1)); this.statsStart = d.toISOString().split('T')[0]; d.setDate(d.getDate() + 6); this.statsEnd = d.toISOString().split('T')[0]; } else if (type === 'month') { const y = d.getFullYear(), m = d.getMonth(); this.statsStart = new Date(y, m, 1, 12).toISOString().split('T')[0]; this.statsEnd = new Date(y, m + 1, 0, 12).toISOString().split('T')[0]; } },
        calculateDuration(t) { if(!t.startTime || !t.completedDate) return '-'; const s = new Date(t.startTime); const e = new Date(t.completedDate); const diff = (e - s) / 60000; if(diff < 0) return '-'; const h = Math.floor(diff / 60); const m = Math.floor(diff % 60); return (h > 0 ? h + 'h ' : '') + m + 'm'; },
        checkScheduledTasks() { const todayStr = this.today; const todayDate = new Date(todayStr); let addedCount = 0; this.scheduledTasks.forEach(sch => { if (!sch.enabled) return; let checkDate; if (sch.lastGeneratedDate) { const last = new Date(sch.lastGeneratedDate); checkDate = new Date(last); checkDate.setDate(checkDate.getDate() + 1); } else { checkDate = new Date(todayDate); } while (checkDate <= todayDate) { const dayOfWeek = checkDate.getDay(); const dateString = checkDate.toISOString().split('T')[0]; if (sch.repeatDays.includes(dayOfWeek)) { const newTask = { id: Date.now().toString() + Math.random().toString(36).substr(2, 5), title: sch.title, status: 'todo', priority: sch.priority, date: dateString + 'T09:00', deadline: '', note: sch.note, subtasks: JSON.parse(JSON.stringify(sch.subtasks)), expanded: false, isFromSchedule: true }; newTask.subtasks.forEach(s => s.status = 'todo'); this.tasks.push(newTask); addedCount++; } checkDate.setDate(checkDate.getDate() + 1); } sch.lastGeneratedDate = todayStr; }); if(addedCount > 0) this.saveData(); },
        changeDate(offset) { const d = new Date(this.viewDate); d.setDate(d.getDate() + offset); this.viewDate = d.toISOString().split('T')[0]; this.activeTask = null; },
        resetToToday() { this.viewDate = this.today; this.checkScheduledTasks(); },
        switchView(view) { this.currentView = view; this.activeTask = null; if (view === 'dashboard') { this.viewDate = this.today; this.checkScheduledTasks(); } },
        getViewName() { return {dashboard:'任务', templates:'模板', scheduled:'定时', statistics:'统计'}[this.currentView]; },
        selectTask(task) { this.activeTask = task; },
        toggleAll() { this.isAllExpanded = !this.isAllExpanded; this.activeTasks.forEach(t => t.expanded = this.isAllExpanded); },
        deleteTask(id) { if(confirm('⚠️ 确定要删除吗？')) { if (this.currentView === 'dashboard') this.tasks = this.tasks.filter(t => t.id !== id); else if (this.currentView === 'templates') this.templates = this.templates.filter(t => t.id !== id); else if (this.currentView === 'scheduled') this.scheduledTasks = this.scheduledTasks.filter(t => t.id !== id); if(this.activeTask && this.activeTask.id === id) this.activeTask = null; } },
        loadTemplate(event) { const tmpl = this.templates.find(t => t.id === event.target.value); if(tmpl) { this.modal.data.title = tmpl.title; this.modal.data.priority = tmpl.priority; this.modal.data.note = tmpl.note; this.modal.data.subtasks = JSON.parse(JSON.stringify(tmpl.subtasks)); this.modal.data.subtasks.forEach(s => s.status = 'todo'); } event.target.value = ""; },
        exportData() { const blob = new Blob([JSON.stringify({tasks:this.tasks, templates:this.templates, scheduledTasks:this.scheduledTasks}, null, 2)], { type: "application/json" }); const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = `planpro_backup_${this.today}.json`; a.click(); },
        importData(event) { const file = event.target.files[0]; if (!file) return; const reader = new FileReader(); reader.onload = (e) => { try { const json = JSON.parse(e.target.result); if(confirm('恢复数据将合并。是否继续？')) { const merge = (s, t) => { const ids = new Set(t.map(x => x.id)); s.forEach(x => { if(x.expanded===undefined)x.expanded=false; if(!ids.has(x.id)) t.push(x); else t[t.findIndex(o=>o.id===x.id)]=x; }); }; if (json.tasks) merge(json.tasks, this.tasks); if (json.templates) merge(json.templates, this.templates); if (json.scheduledTasks) merge(json.scheduledTasks, this.scheduledTasks); alert('恢复成功！数据已合并并自动同步到云端。'); } } catch (err) { alert('文件无效'); } }; reader.readAsText(file); event.target.value = ''; },
        verifySuper(cb) { const p = prompt("请输入超级密码："); if(p === 'QSQ8888') cb(); else if(p) alert("密码错误"); },
        handleOpenPath() { const size = new Blob([localStorage.getItem('planpro_final_tasks')]).size + new Blob([localStorage.getItem('planpro_final_templates')]).size; alert(`📂 数据存储信息\n\n位置：浏览器内部 LocalStorage (SQLite/LevelDB)\n占用：约 ${(size/1024).toFixed(2)} KB\n\n作者：双鱼\n当前版本：v3.0.0`); },
        openModal(task = null) { this.modal.show = true; if(task) { this.modal.isEdit = true; this.modal.data = JSON.parse(JSON.stringify(task)); if(this.modal.data.subtasks) this.modal.data.subtasks.forEach(s => { if(!s._key) s._key = Math.random(); }); } else { this.modal.isEdit = false; const nowTime = new Date().toTimeString().slice(0,5); const defaultDateTime = (this.currentView === 'dashboard') ? this.viewDate + 'T' + nowTime : this.today + 'T09:00'; this.modal.data = { id: Date.now().toString(), title:'', status:'todo', priority:'normal', date: defaultDateTime, deadline:'', note:'', subtasks:[], expanded:false, repeatDays: this.currentView === 'scheduled' ? [1,2,3,4,5] : [], enabled: true }; } },
        addModalSubtask() { const val = this.$refs.newSubInput.value.trim(); if(val) { if(!this.modal.data.subtasks) this.modal.data.subtasks = []; this.modal.data.subtasks.push({ title: val, status: 'todo', _key: Math.random() }); this.$refs.newSubInput.value = ''; } },
        saveTask() { if(!this.modal.data.title.trim()) return; const d = this.modal.data; if(this.currentView === 'dashboard' && d.status==='done') { const now = new Date(); d.completedDate = new Date(now.getTime() - (now.getTimezoneOffset() * 60000)).toISOString().slice(0,16); } let arr = this.currentView === 'dashboard' ? this.tasks : (this.currentView === 'templates' ? this.templates : this.scheduledTasks); if(this.modal.isEdit) { const idx = arr.findIndex(t=>t.id === d.id); d.expanded = arr[idx].expanded; arr[idx] = d; if(this.activeTask && this.activeTask.id === d.id) this.activeTask = d; } else { arr.push(d); } this.modal.show = false; },
        addInlineSubtask(task, e) { const val = e.target.value.trim(); if(val) { task.subtasks.push({ title:val, status:'todo', _key: Math.random() }); e.target.value = ''; } },
        isOverdue(t) { if(!t.deadline) return false; const currentLocal = new Date(this.now.getTime() - (this.now.getTimezoneOffset() * 60000)).toISOString().slice(0,16); return t.deadline < currentLocal; },
        isDueToday(t) { return t.deadline && t.deadline.startsWith(this.today); },
        calculateProgress(t) { if(!t.subtasks || !t.subtasks.length) return 0; return (t.subtasks.filter(s=>s.status==='done').length / t.subtasks.length) * 100; },
        getLatestNoteLine(n) { return n ? n.split('\n').filter(l=>l.trim()).pop() : ''; },
        getStatusStyle(s) { return { 'todo': 'bg-slate-100 text-slate-500 border-slate-200', 'doing': 'bg-blue-50 text-blue-600 border-blue-200', 'done': 'bg-green-50 text-green-600 border-green-200' }[s]; },
        getPriorityStyle(p) { return { 'normal': 'bg-white text-slate-600 border-slate-200 hover:border-blue-300', 'urgent': 'bg-orange-50 text-orange-600 border-orange-200', 'critical': 'bg-red-50 text-red-600 border-red-200' }[p]; },
        formatRepeatDays(days) { if(!days || days.length === 0) return ['无']; const map = {1:'一',2:'二',3:'三',4:'四',5:'五',6:'六',0:'日'}; return days.sort((a,b) => (a===0?7:a) - (b===0?7:b)).map(d => '周'+map[d]); },
        formatTimeOnly(dateTimeStr) { if (!dateTimeStr) return ''; if (dateTimeStr.includes('T')) return dateTimeStr.split('T')[1]; return ''; },
        formatDateTime(dateTimeStr) { if (!dateTimeStr) return ''; return dateTimeStr.replace('T', ' '); },
        getStatsStatusStyle(t) { if(t.status === 'done') { if(t.deadline && t.completedDate > t.deadline) return 'bg-red-100 text-red-700 border-red-200'; return 'bg-green-100 text-green-700 border-green-200'; } if(t.status === 'doing') return 'bg-blue-100 text-blue-700 border-blue-200'; return 'bg-slate-100 text-slate-500 border-slate-200'; },
        getStatsStatusLabel(t) { if(t.status === 'done') { if(t.deadline && t.completedDate > t.deadline) return '超时完成'; return '已完成'; } return { 'todo':'未开始', 'doing':'进行中' }[t.status]; }
    }
}).mount('#app');
