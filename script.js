// --- Supabase 配置 ---
const SUPABASE_URL = 'https://scjswpjktydojedqywxq.supabase.co'; // 你的真实 URL
const SUPABASE_KEY = 'sb_publishable_TSXrb7sbhV7l5hgqjC0KuA_dVdxmSpu'; // 你的真实 KEY

const supabaseClient = window.supabase.createClient(SUPABASE_URL, SUPABASE_KEY);

const { createApp } = Vue;

createApp({
    data() {
        return {
            isRegisterMode: false,
            accessKey: null,
            userId: null,
            inputKey: '',
            inputPassword: '',

            isSyncing: 'idle',
            saveTimer: null,
            lastDataHash: '',
            isDarkMode: false,

            aiInput: '',
            chatHistory: [],
            showAiPanel: false,

            today: new Date().toISOString().split('T')[0],
            viewDate: new Date().toISOString().split('T')[0],
            now: new Date(),
            currentView: 'dashboard',

            groups: [],
            activeGroupId: 'all',
            tasks: [],
            templates: [],
            scheduledTasks: [],
            activeTask: null,
            modal: { show: false, isEdit: false, data: {} },
            isAllExpanded: false,

            // 🌟 核心：管理打开的多个富文本窗口及拖拽状态
            openEditors: [],
            baseZIndex: 100, // 窗口初始层级
            dragState: {
                isDragging: false,
                index: -1,
                startX: 0,
                startY: 0,
                initialX: 0,
                initialY: 0
            },

            // 🌟 核心：存储本地文件的可访问性字典 { 'doc_id': true / false }
            localAccessMap: {},

            statsStart: new Date().toISOString().split('T')[0],
            statsEnd: new Date().toISOString().split('T')[0],
            statsStatus: 'all',
            statsGroupId: 'all',
            statsRangeType: 'week'
        }
    },
    computed: {
        syncStatus() {
            if (this.isSyncing === 'syncing') return { text: '同步中...', class: 'bg-blue-50 dark:bg-blue-900/30 text-blue-600 dark:text-blue-400 border-blue-200 dark:border-blue-800', icon: 'ph ph-spinner animate-spin' };
            if (this.isSyncing === 'done') return { text: '已同步', class: 'bg-green-50 dark:bg-green-900/30 text-green-600 dark:text-green-400 border-green-200 dark:border-green-800', icon: 'ph-bold ph-check' };
            if (this.isSyncing === 'error') return { text: '同步失败', class: 'bg-red-50 dark:bg-red-900/30 text-red-600 dark:text-red-400 border-red-200 dark:border-red-800', icon: 'ph-bold ph-warning' };
            return { text: '就绪', class: 'bg-slate-50 dark:bg-slate-800 text-slate-400 dark:text-slate-500 border-slate-200 dark:border-slate-700', icon: 'ph ph-cloud' };
        },
        dateInfo() {
            const date = new Date(this.viewDate);
            return { date: date.toLocaleDateString('zh-CN', { month: 'long', day: 'numeric' }), week: date.toLocaleDateString('zh-CN', { weekday: 'long' }) };
        },
        futurePreviews() {
            if (this.viewDate <= this.today) return [];
            const targetDay = new Date(this.viewDate).getDay();
            let list = this.scheduledTasks.filter(s => s.enabled && s.repeatDays.includes(targetDay === 0 ? 7 : targetDay));
            if (this.activeGroupId !== 'all') {
                list = list.filter(t => (t.groupId || '') === this.activeGroupId);
            }
            return list.map(s => ({ ...s, id: 'preview_' + s.id, status: 'todo', isPreview: true }));
        },
        activeTasks() {
            const list = this.tasks.filter(t => {
                const taskDate = t.date.split('T')[0];
                if (t.status === 'done') return false;

                if (this.viewDate === this.today) {
                } else {
                    if (taskDate !== this.viewDate) return false;
                }

                if (this.activeGroupId !== 'all' && (t.groupId || '') !== this.activeGroupId) {
                    return false;
                }
                return true;
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
                return a.date > b.date ? 1 : -1;
            });
        },
        completedTasks() {
            return this.tasks.filter(t => {
                if (t.status !== 'done') return false;

                if (this.viewDate === this.today) {
                    if (t.date.split('T')[0] !== this.today && !(t.completedDate && t.completedDate.split('T')[0] === this.today)) {
                        return false;
                    }
                } else {
                    if (t.date.split('T')[0] !== this.viewDate) return false;
                }

                if (this.activeGroupId !== 'all' && (t.groupId || '') !== this.activeGroupId) {
                    return false;
                }
                return true;
            });
        },
        enabledScheduledCount() { return this.scheduledTasks.filter(t => t.enabled).length; },
    },
    watch: {
        isDarkMode(val) {
            if (val) {
                document.documentElement.classList.add('dark');
                localStorage.setItem('planpro_theme', 'dark');
            } else {
                document.documentElement.classList.remove('dark');
                localStorage.setItem('planpro_theme', 'light');
            }
        },
        tasks: { handler() { if (this.userId) this.saveData(); }, deep: true },
        templates: { handler() { if (this.userId) this.saveData(); }, deep: true },
        scheduledTasks: { handler() { if (this.userId) this.saveData(); }, deep: true },
        groups: { handler() { if (this.userId) this.saveData(); }, deep: true }
    },
    mounted() {
        const savedTheme = localStorage.getItem('planpro_theme');
        if (savedTheme === 'dark' || (!savedTheme && window.matchMedia('(prefers-color-scheme: dark)').matches)) {
            this.isDarkMode = true;
            document.documentElement.classList.add('dark');
        }

        const savedKey = localStorage.getItem('planpro_access_key');
        const savedId = localStorage.getItem('planpro_user_id');
        if (savedKey && savedId) {
            this.accessKey = savedKey;
            this.userId = savedId;
            this.loadData();
        }

        // 请求浏览器持久化存储权限 (防止 indexedDB 丢失)
        if (navigator.storage && navigator.storage.persist) {
            navigator.storage.persist().then(isPersisted => {
                console.log(`持久化存储状态: ${isPersisted ? '已开启' : '未开启'}`);
            });
        }

        setInterval(() => {
            this.now = new Date();
            const nowIso = new Date(this.now.getTime() - (this.now.getTimezoneOffset() * 60000)).toISOString().slice(0, 16);
            let tasksChanged = false;

            this.tasks.forEach(t => {
                if (t.status === 'todo' && t.date && t.date <= nowIso) {
                    t.status = 'doing';
                    this.updateStatus(t);
                    tasksChanged = true;
                }
            });

            if (this.currentView === 'dashboard' && this.viewDate === this.today) {
                this.checkScheduledTasks();
            }
            if (tasksChanged && this.userId) this.saveData();
        }, 60000);

        window.history.pushState('trap', null, '');
        window.addEventListener('popstate', this.handlePopState);
    },
    methods: {
        toggleTheme() { this.isDarkMode = !this.isDarkMode; },

        // =========================================================
        // 🌟 本地文件检测、附件管理与拖拽窗口 🌟
        // =========================================================

        // 核对哪些本地文件在本设备上是可用的
        async checkLocalFilesAccessibility() {
            try {
                // 瞬间获取本地数据库所有的 key 
                const keys = await localforage.keys();
                const keySet = new Set(keys);
                
                this.tasks.forEach(task => {
                    if (task.attachments) {
                        task.attachments.forEach(doc => {
                            if (doc.type === 'local_file') {
                                // 如果 key 存在于本地，则为 true，否则为 false
                                this.localAccessMap[doc.id] = keySet.has(doc.id);
                            }
                        });
                    }
                });
            } catch (error) {
                console.error("检测本地文件可用性失败", error);
            }
        },

        // 打开附件分发
        async openAttachment(task, doc = null) {
            if (!doc) {
                this.openMdEditor(task, null);
                return;
            }

            if (doc.type === 'richtext') {
                this.openMdEditor(task, doc);
            } else if (doc.type === 'local_file') {
                try {
                    const fileBlob = await localforage.getItem(doc.id);
                    if (!fileBlob) {
                        // 简化提示词
                        alert(`非本机上传文件，不可显示`);
                        return;
                    }
                    const url = URL.createObjectURL(fileBlob);
                    const a = document.createElement('a');
                    a.href = url;
                    a.download = doc.title;
                    document.body.appendChild(a);
                    a.click();
                    document.body.removeChild(a);
                    URL.revokeObjectURL(url);
                } catch (error) {
                    console.error("读取本地文件失败:", error);
                    alert("文件读取失败");
                }
            }
        },

        // 本地文件上传保存
        async handleLocalFileUpload(event) {
            const file = event.target.files[0];
            if (!file) return;

            if (file.size > 50 * 1024 * 1024) {
                alert("文件过大！建议本地缓存的单文件不要超过 50MB。");
                event.target.value = '';
                return;
            }

            const docId = 'local_' + Date.now() + Math.random().toString(36).substr(2, 4);
            const attachmentMeta = {
                id: docId,
                type: 'local_file',
                title: file.name,
                size: file.size,
                created_at: new Date().toISOString()
            };

            try {
                await localforage.setItem(docId, file);

                if (!this.activeTask.attachments) this.activeTask.attachments = [];
                this.activeTask.attachments.push(attachmentMeta);

                await supabaseClient.from('tasks').update({ attachments: this.activeTask.attachments }).eq('id', this.activeTask.id);
                
                this.updateStatus(this.activeTask);
                // 上传后重新检测一次可用性
                await this.checkLocalFilesAccessibility();

            } catch (error) {
                alert("文件保存失败！");
            }
            event.target.value = '';
        },

        // --- 拖拽窗口的四个核心方法 ---
        bringToFront(index) {
            this.baseZIndex++;
            this.openEditors[index].zIndex = this.baseZIndex;
        },

        startDrag(event, index) {
            this.bringToFront(index);
            this.dragState.isDragging = true;
            this.dragState.index = index;
            // 记录鼠标按下的起始位置
            this.dragState.startX = event.clientX;
            this.dragState.startY = event.clientY;
            // 记录窗口当时的初始坐标
            this.dragState.initialX = this.openEditors[index].x;
            this.dragState.initialY = this.openEditors[index].y;
            
            // 在整个页面监听移动和松开事件，防止鼠标滑出弹窗后失效
            document.addEventListener('mousemove', this.onDrag);
            document.addEventListener('mouseup', this.stopDrag);
        },

        onDrag(event) {
            if (!this.dragState.isDragging) return;
            // 计算鼠标移动的偏移量
            const dx = event.clientX - this.dragState.startX;
            const dy = event.clientY - this.dragState.startY;
            // 更新窗口坐标
            this.openEditors[this.dragState.index].x = this.dragState.initialX + dx;
            this.openEditors[this.dragState.index].y = this.dragState.initialY + dy;
        },

        stopDrag() {
            this.dragState.isDragging = false;
            document.removeEventListener('mousemove', this.onDrag);
            document.removeEventListener('mouseup', this.stopDrag);
        },

        // 🌟 支持多开的富文本编辑器窗口
        openMdEditor(task, doc = null) {
            if (!task.attachments) task.attachments = [];
            
            let newData;
            if (doc) {
                newData = JSON.parse(JSON.stringify(doc));
            } else {
                newData = { id: 'doc_' + Date.now(), type: 'richtext', title: '', content: '', created_at: new Date().toISOString() };
            }

            if (this.openEditors.find(e => e.data.id === newData.id)) return;

            this.baseZIndex++;
            
            // 默认错开位置呈现，支持 x, y 坐标和 zIndex 层级
            this.openEditors.push({
                data: newData,
                targetTask: task,
                quillInstance: null,
                x: 100 + (this.openEditors.length * 40),
                y: 60 + (this.openEditors.length * 40),
                zIndex: this.baseZIndex
            });

            const index = this.openEditors.length - 1;

            this.$nextTick(() => {
                const containerId = '#quill-editor-' + newData.id;
                const quill = new Quill(containerId, {
                    theme: 'snow',
                    modules: { 
                        toolbar: [
                            [{ 'size': ['small', false, 'large'] }], 
                            [{ 'color': [] }, { 'background': [] }],
                            ['bold', 'italic', 'strike', 'underline'],      
                            [{ 'list': 'ordered'}, { 'list': 'bullet' }],   
                            ['clean']                                       
                        ] 
                    },
                    placeholder: '记录内容...'
                });

                if (newData.content) quill.root.innerHTML = newData.content;
                this.openEditors[index].quillInstance = quill;
            });
        },

        async saveMdDoc(index) {
            const editor = this.openEditors[index];
            const task = editor.targetTask;
            if (!task.attachments) task.attachments = [];

            editor.data.content = editor.quillInstance.root.innerHTML;

            const aIndex = task.attachments.findIndex(a => a.id === editor.data.id);
            if (aIndex > -1) {
                task.attachments[aIndex] = JSON.parse(JSON.stringify(editor.data));
            } else {
                task.attachments.push(JSON.parse(JSON.stringify(editor.data)));
            }

            try {
                await supabaseClient.from('tasks').update({ attachments: task.attachments }).eq('id', task.id);
            } catch (err) { console.error(err); }

            this.updateStatus(task);
            this.closeMdEditor(index);
        },

        closeMdEditor(index) {
            this.openEditors.splice(index, 1);
        },

        async deleteAttachment(task, docId, docType) {
            if (confirm('确定要永久移除此文件吗？(不可恢复)')) {
                task.attachments = task.attachments.filter(a => a.id !== docId);
                
                try {
                    if (docType === 'local_file') await localforage.removeItem(docId);
                    await supabaseClient.from('tasks').update({ attachments: task.attachments }).eq('id', task.id);
                } catch(e) { console.error("删除失败:", e); }

                const taskIndex = this.tasks.findIndex(t => t.id === task.id);
                if (taskIndex > -1) this.tasks.splice(taskIndex, 1, task);
                
                await this.checkLocalFilesAccessibility();
            }
        },

        // =========================================================

        handlePopState(e) {
            let handled = false;
            if (this.openEditors.length > 0) { this.openEditors.pop(); handled = true; }
            else if (this.modal.show) { this.modal.show = false; handled = true; }
            else if (this.showAiPanel) { this.showAiPanel = false; handled = true; }
            else if (this.activeTask && window.innerWidth <= 768) { this.activeTask = null; handled = true; }

            if (handled) window.history.pushState('trap', null, '');
            else {
                if (confirm('确定要退出应用吗？')) window.history.back();
                else window.history.pushState('trap', null, '');
            }
        },

        generateDataHash() {
            return JSON.stringify({ t: this.tasks.map(({ expanded, ...rest }) => rest), tm: this.templates, s: this.scheduledTasks, g: this.groups });
        },
        getGroupName(id) {
            if (!id) return '无'; const g = this.groups.find(x => x.id === id); return g ? g.name : '无';
        },

        // ... 业务请求方法
        async handleAuth() {
            if (!this.inputKey.trim() || !this.inputPassword.trim()) return alert("账号和密码不能为空");
            this.isSyncing = 'syncing';
            try {
                if (this.isRegisterMode) {
                    const { data, error } = await supabaseClient.rpc('register_user', { p_access_key: this.inputKey.trim(), p_password: this.inputPassword });
                    if (error) throw new Error(error.message.includes('unique') ? '该账号已被注册' : error.message);
                    this.userId = data;
                    alert("注册成功！已为您自动登录。");
                } else {
                    const { data, error } = await supabaseClient.rpc('verify_login', { p_access_key: this.inputKey.trim(), p_password: this.inputPassword });
                    if (error) throw error;
                    if (!data) return alert("账号或密码错误");
                    this.userId = data;
                }
                this.accessKey = this.inputKey.trim();
                localStorage.setItem('planpro_access_key', this.accessKey);
                localStorage.setItem('planpro_user_id', this.userId);
                await this.loadData();
            } catch (e) { alert("错误: " + e.message); this.isSyncing = 'error'; }
        },

        logout() {
            if (confirm("确定要退出当前账号吗？")) {
                localStorage.removeItem('planpro_access_key'); localStorage.removeItem('planpro_user_id');
                this.accessKey = null; this.userId = null; this.inputKey = ''; this.inputPassword = '';
                this.tasks = []; this.templates = []; this.scheduledTasks = []; this.groups = [];
            }
        },

        async loadData() {
            this.isSyncing = 'syncing';
            try {
                let groupsRes = { data: [] };
                try {
                    groupsRes = await supabaseClient.from('groups').select('*').eq('user_id', this.userId);
                    if (groupsRes.error) throw groupsRes.error;
                } catch (e) { }

                const [tasksRes, templatesRes, scheduledRes] = await Promise.all([
                    supabaseClient.from('tasks').select('*').eq('user_id', this.userId),
                    supabaseClient.from('templates').select('*').eq('user_id', this.userId),
                    supabaseClient.from('scheduled_tasks').select('*').eq('user_id', this.userId)
                ]);

                this.groups = groupsRes.data || [];
                this.tasks = (tasksRes.data || []).map(t => ({
                    ...t,
                    date: t.plan_date ? t.plan_date.substring(0, 16) : '',
                    deadline: t.deadline ? t.deadline.substring(0, 16) : '',
                    startTime: t.start_time ? t.start_time.substring(0, 16) : null,
                    completedDate: t.completed_date ? t.completed_date.substring(0, 16) : null,
                    isFromSchedule: t.is_from_schedule,
                    groupId: t.group_id || '',
                    attachments: t.attachments || [],
                    expanded: false
                }));

                this.templates = (templatesRes.data || []).map(t => ({ ...t, groupId: t.group_id || '' }));
                this.scheduledTasks = (scheduledRes.data || []).map(s => ({ ...s, repeatDays: s.repeat_days || [], lastGeneratedDate: s.last_generated_date, groupId: s.group_id || '' }));

                this.lastDataHash = this.generateDataHash();
                this.isSyncing = 'done';
                setTimeout(() => { if (this.isSyncing === 'done') this.isSyncing = 'idle'; }, 2000);
                
                this.checkScheduledTasks();
                // 🌟 数据加载完毕后，检测本地文件的可用性
                await this.checkLocalFilesAccessibility();

            } catch (e) { this.isSyncing = 'error'; }
        },

        saveData() {
            if (!this.userId) return;
            const currentHash = this.generateDataHash();
            if (this.lastDataHash === currentHash) return;
            this.lastDataHash = currentHash;

            this.isSyncing = 'syncing';
            if (this.saveTimer) clearTimeout(this.saveTimer);

            this.saveTimer = setTimeout(async () => {
                try {
                    const dbTasks = this.tasks.map(t => ({
                        id: t.id, user_id: this.userId, title: t.title, status: t.status, priority: t.priority,
                        plan_date: t.date || null, deadline: t.deadline || null, start_time: t.startTime || null,
                        completed_date: t.completedDate || null, note: t.note || '', subtasks: t.subtasks || [],
                        attachments: t.attachments || [], is_from_schedule: t.isFromSchedule || false,
                        group_id: t.groupId || null, updated_at: new Date().toISOString()
                    }));

                    const dbTemplates = this.templates.map(t => ({
                        id: t.id, user_id: this.userId, title: t.title, priority: t.priority || 'normal',
                        note: t.note || '', subtasks: t.subtasks || [], group_id: t.groupId || null
                    }));

                    const dbScheduled = this.scheduledTasks.map(s => ({
                        id: s.id, user_id: this.userId, title: s.title, enabled: s.enabled, repeat_days: s.repeatDays || [],
                        priority: s.priority || 'normal', note: s.note || '', subtasks: s.subtasks || [],
                        last_generated_date: s.lastGeneratedDate || null, group_id: s.groupId || null
                    }));

                    const dbGroups = this.groups.map(g => ({ id: g.id, user_id: this.userId, name: g.name }));

                    const promises = [];
                    if (dbTasks.length > 0) promises.push(supabaseClient.from('tasks').upsert(dbTasks));
                    if (dbTemplates.length > 0) promises.push(supabaseClient.from('templates').upsert(dbTemplates));
                    if (dbScheduled.length > 0) promises.push(supabaseClient.from('scheduled_tasks').upsert(dbScheduled));
                    if (dbGroups.length > 0) { try { promises.push(supabaseClient.from('groups').upsert(dbGroups)); } catch (e) { } }

                    await Promise.all(promises);
                    this.isSyncing = 'done';
                    setTimeout(() => { if (this.isSyncing === 'done') this.isSyncing = 'idle'; }, 3000);
                } catch (error) { this.isSyncing = 'error'; }
            }, 1500);
        },

        createGroup() {
            const name = prompt('请输入新工作组名称:');
            if (name && name.trim()) {
                const newId = 'g_' + Date.now();
                this.groups.push({ id: newId, name: name.trim(), user_id: this.userId });
                this.activeGroupId = newId;
            }
        },

        deleteGroup(id) {
            if (confirm('确定删除该分组吗？此分组下的任务将被归为"无"分组。')) {
                this.groups = this.groups.filter(g => g.id !== id);
                this.activeGroupId = 'all';
                this.tasks.forEach(t => { if (t.groupId === id) t.groupId = ''; });
                this.templates.forEach(t => { if (t.groupId === id) t.groupId = ''; });
                this.scheduledTasks.forEach(t => { if (t.groupId === id) t.groupId = ''; });
            }
        },

        async deleteTask(id) {
            if (confirm('确定删除？')) {
                try {
                    if (this.currentView === 'dashboard') { this.tasks = this.tasks.filter(t => t.id !== id); await supabaseClient.from('tasks').delete().eq('id', id); }
                    else if (this.currentView === 'templates') { this.templates = this.templates.filter(t => t.id !== id); await supabaseClient.from('templates').delete().eq('id', id); }
                    else { this.scheduledTasks = this.scheduledTasks.filter(t => t.id !== id); await supabaseClient.from('scheduled_tasks').delete().eq('id', id); }
                    if (this.activeTask?.id === id) this.activeTask = null;
                } catch (e) { }
            }
        },

        onScheduleToggle(sch) {
            if (sch.enabled) {
                const yesterday = new Date(this.now);
                yesterday.setDate(yesterday.getDate() - 1);
                sch.lastGeneratedDate = yesterday.toISOString().split('T')[0];
            }
        },

        checkScheduledTasks() {
            const todayDate = new Date(this.today);
            let addedCount = 0;

            this.scheduledTasks.forEach(sch => {
                if (!sch.enabled) return;

                if (!sch.lastGeneratedDate) {
                    const yesterday = new Date(todayDate); yesterday.setDate(yesterday.getDate() - 1);
                    sch.lastGeneratedDate = yesterday.toISOString().split('T')[0];
                }

                let checkDate = new Date(sch.lastGeneratedDate);
                checkDate.setDate(checkDate.getDate() + 1);

                while (checkDate <= todayDate) {
                    const dayOfWeek = checkDate.getDay();
                    if (sch.repeatDays.includes(dayOfWeek)) {
                        const taskTime = checkDate.toISOString().split('T')[0] + 'T09:00';
                        const newNote = `${taskTime} ${sch.note || ''}`.trim();

                        this.tasks.push({
                            id: Date.now() + Math.random().toString(36).substr(2, 5),
                            title: sch.title, status: 'todo', priority: sch.priority, date: taskTime,
                            deadline: '', note: newNote, subtasks: JSON.parse(JSON.stringify(sch.subtasks || [])),
                            attachments: [], expanded: false, isFromSchedule: true, groupId: sch.groupId || ''
                        });
                        addedCount++;
                    }
                    checkDate.setDate(checkDate.getDate() + 1);
                }
                sch.lastGeneratedDate = this.today;
            });
            if (addedCount > 0) this.saveData();
        },

        // ... 剩余 UI 小工具、AI 助手保持完全不变
        exportData() { const blob = new Blob([JSON.stringify({ tasks: this.tasks, templates: this.templates, scheduledTasks: this.scheduledTasks, groups: this.groups }, null, 2)], { type: "application/json" }); const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = `backup_${this.today}.json`; a.click(); },
        importData(event) { const file = event.target.files[0]; if (!file) return; const reader = new FileReader(); reader.onload = (e) => { try { const json = JSON.parse(e.target.result); if (json.tasks) this.tasks = json.tasks; if (json.templates) this.templates = json.templates; if (json.scheduledTasks) this.scheduledTasks = json.scheduledTasks; if (json.groups) this.groups = json.groups; alert("导入成功！"); } catch { alert('无效文件'); } event.target.value = ''; }; reader.readAsText(file); },
        async importOldData(event) {
            const file = event.target.files[0]; if (!file) return;
            const reader = new FileReader();
            reader.onload = async (e) => {
                try {
                    const json = JSON.parse(e.target.result); let importCount = 0;
                    if (json.tasks && Array.isArray(json.tasks)) { const existingIds = new Set(this.tasks.map(t => t.id)); const newTasks = json.tasks.filter(t => !existingIds.has(t.id)); this.tasks = [...this.tasks, ...newTasks]; importCount += newTasks.length; }
                    if (json.templates && Array.isArray(json.templates)) { const existingIds = new Set(this.templates.map(t => t.id)); const newTmpls = json.templates.filter(t => !existingIds.has(t.id)); this.templates = [...this.templates, ...newTmpls]; importCount += newTmpls.length; }
                    if (json.scheduledTasks && Array.isArray(json.scheduledTasks)) { const existingIds = new Set(this.scheduledTasks.map(t => t.id)); const newSch = json.scheduledTasks.filter(t => !existingIds.has(t.id)); this.scheduledTasks = [...this.scheduledTasks, ...newSch]; importCount += newSch.length; }
                    if (importCount > 0) alert(`🎉 成功导入了 ${importCount} 条历史数据！`); else alert('✅ 文件解析成功，但没有新数据。');
                } catch (err) { alert('解析失败'); }
                event.target.value = '';
            }; reader.readAsText(file);
        },

        updateStatus(task) {
            const nowIso = new Date(this.now.getTime() - (this.now.getTimezoneOffset() * 60000)).toISOString().slice(0, 16);
            if (task.status === 'doing') { if (!task.startTime) task.startTime = nowIso; if (!task.date) task.date = nowIso; task.completedDate = null; } 
            else if (task.status === 'done') { if (!task.startTime) task.startTime = nowIso; if (!task.date) task.date = nowIso; task.completedDate = nowIso; if (task.subtasks) task.subtasks.forEach(s => s.status = 'done'); } 
            else { task.startTime = null; task.completedDate = null; }
            const index = this.tasks.findIndex(t => t.id === task.id); if(index !== -1) this.tasks.splice(index, 1, task);
        },

        changeDate(off) { const d = new Date(this.viewDate); d.setDate(d.getDate() + off); this.viewDate = d.toISOString().split('T')[0]; this.activeTask = null; },
        resetToToday() { this.viewDate = this.today; this.checkScheduledTasks(); },
        switchView(view) { this.currentView = view; this.activeTask = null; if (view === 'dashboard') { this.viewDate = this.today; this.checkScheduledTasks(); } },
        toggleAiPanel() { this.showAiPanel = !this.showAiPanel; if (this.showAiPanel) this.activeTask = null; },
        selectTask(task) { this.showAiPanel = false; this.activeTask = task; },
        toggleAll() { this.isAllExpanded = !this.isAllExpanded; this.activeTasks.forEach(t => t.expanded = this.isAllExpanded); },
        loadTemplate(e) { const t = this.templates.find(x => x.id === e.target.value); if (t) { this.modal.data.title = t.title; this.modal.data.priority = t.priority; this.modal.data.subtasks = JSON.parse(JSON.stringify(t.subtasks)); } e.target.value = ''; },
        openModal(task) { this.modal.show = true; this.modal.isEdit = !!task; const defaultGroupId = this.activeGroupId === 'all' ? '' : this.activeGroupId; this.modal.data = task ? JSON.parse(JSON.stringify(task)) : { id: Date.now().toString(), title: '', status: 'todo', priority: 'normal', date: this.currentView === 'dashboard' ? this.viewDate + 'T12:00' : this.today + 'T09:00', subtasks: [], repeatDays: [], groupId: defaultGroupId }; },
        addModalSubtask() { const v = this.$refs.newSubInput.value.trim(); if (v) { if (!this.modal.data.subtasks) this.modal.data.subtasks = []; this.modal.data.subtasks.push({ title: v, status: 'todo' }); this.$refs.newSubInput.value = ''; } },
        saveTask() { if (!this.modal.data.title) return; const d = this.modal.data; const arr = this.currentView === 'dashboard' ? this.tasks : (this.currentView === 'templates' ? this.templates : this.scheduledTasks); if (this.modal.isEdit) { const i = arr.findIndex(t => t.id === d.id); d.expanded = arr[i].expanded; arr[i] = d; if (this.activeTask?.id === d.id) this.activeTask = d; } else arr.push(d); this.modal.show = false; },
        isOverdue(t) { if (!t.deadline) return false; const now = new Date(this.now.getTime() - (this.now.getTimezoneOffset() * 60000)).toISOString().slice(0, 16); return t.deadline < now; },
        getLatestNoteLine(n) { return n ? n.split('\n').filter(l => l.trim()).pop() : ''; },
        getStatusStyle(s) { return { 'todo': 'bg-slate-100 dark:bg-slate-700/50 text-slate-500 dark:text-slate-400', 'doing': 'bg-blue-50 dark:bg-blue-900/30 text-blue-600 dark:text-blue-400', 'done': 'bg-green-50 dark:bg-green-900/30 text-green-600 dark:text-green-400' }[s]; },
        getPriorityStyle(p) { return { 'normal': 'text-blue-500 dark:text-blue-400', 'urgent': 'text-orange-500 dark:text-orange-400', 'critical': 'text-red-500 dark:text-red-400' }[p]; },
        formatDateTime(d) { return d ? d.replace('T', ' ') : ''; },
        formatTimeOnly(d) { return d && d.includes('T') ? d.split('T')[1] : ''; },

        async sendAiMessage() {
            const text = this.aiInput.trim(); if (!text) return;
            this.chatHistory.push({ role: 'user', type: 'text', content: text }); this.aiInput = ''; this.chatHistory.push({ role: 'assistant', type: 'loading' }); this.$nextTick(() => this.scrollToBottom());
            try {
                const result = await this.analyzeAiIntent(text); this.chatHistory.pop();
                if (result) this.chatHistory.push({ role: 'assistant', type: 'task_card', data: result, confirmed: false });
                else this.chatHistory.push({ role: 'assistant', type: 'text', content: 'AI 似乎没有理解，请尝试描述得更具体一点。' });
            } catch (error) { this.chatHistory.pop(); this.chatHistory.push({ role: 'assistant', type: 'text', content: `请求出错: ${error.message}` }); }
            this.$nextTick(() => this.scrollToBottom());
        },
        confirmAiTask(taskData, msgIndex) { this.tasks.push(taskData); this.chatHistory[msgIndex].confirmed = true; this.chatHistory.push({ role: 'assistant', type: 'text', content: `✅ 任务 "${taskData.title}" 已成功添加！` }); this.$nextTick(() => this.scrollToBottom()); },
        async analyzeAiIntent(userText) {
            const nowIso = new Date(new Date().getTime() - (new Date().getTimezoneOffset() * 60000)).toISOString().slice(0, 16);
            const systemInstructions = `你是一个助手。当前时间：${nowIso}。只返回JSON格式 {"title":"名", "date":"YYYY-MM-DDTHH:mm", "priority":"normal/urgent", "note":""}`;
            const response = await fetch(`https://www.yuyuworkplan-pro.xyz/api/chat`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ message: `${systemInstructions}\n\n用户: ${userText}` }) });
            if (!response.ok) throw new Error(`API 响应错误`);
            const data = await response.json();
            let cleanJsonStr = (data.choices?.[0]?.message?.content || "").replace(/`{3}(?:json)?/gi, '').trim();
            const jsonMatch = cleanJsonStr.match(/(\{[\s\S]*\}|\[[\s\S]*\])/); if (jsonMatch) cleanJsonStr = jsonMatch[0];
            let parsed = JSON.parse(cleanJsonStr); if (Array.isArray(parsed)) parsed = parsed[0];
            let aiDate = parsed.date || this.today + "T09:00"; aiDate = aiDate.replace(' ', 'T').replace(/\//g, '-');
            return { id: Date.now().toString(), title: parsed.title || "未命名任务", date: aiDate.length === 10 ? aiDate + "T09:00" : aiDate.substring(0, 16), status: 'todo', priority: parsed.priority || 'normal', subtasks: [], note: parsed.note || '', groupId: this.activeGroupId === 'all' ? '' : this.activeGroupId, expanded: false };
        },
        scrollToBottom() { const c = this.$refs.chatContainer; if (c) c.scrollTop = c.scrollHeight; }
    }
}).mount('#app');