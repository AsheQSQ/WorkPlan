import { store, getters, actions } from './store.js';
import AuthModal from './components/AuthModal.js';
import Sidebar from './components/Sidebar.js';
import AppMain from './components/AppMain.js';
import AiPanel from './components/AiPanel.js';
import TaskModal from './components/TaskModal.js';
import MdEditors from './components/MdEditors.js';

const { createApp, watch, onMounted, toRefs } = Vue;

const app = createApp({
    components: { AuthModal, Sidebar, AppMain, AiPanel, TaskModal, MdEditors },
    setup() {
        watch(() => store.isDarkMode, (val) => {
            if (val) { document.documentElement.classList.add('dark'); localStorage.setItem('planpro_theme', 'dark'); } 
            else { document.documentElement.classList.remove('dark'); localStorage.setItem('planpro_theme', 'light'); }
        });
        watch([() => store.tasks, () => store.templates, () => store.scheduledTasks, () => store.groups], () => {
            if (store.userId) actions.saveData();
        }, { deep: true });

        onMounted(() => {
            const savedTheme = localStorage.getItem('planpro_theme');
            if (savedTheme === 'dark' || (!savedTheme && window.matchMedia('(prefers-color-scheme: dark)').matches)) { store.isDarkMode = true; document.documentElement.classList.add('dark'); }
            const savedKey = localStorage.getItem('planpro_access_key'); const savedId = localStorage.getItem('planpro_user_id');
            if (savedKey && savedId) { store.accessKey = savedKey; store.userId = savedId; actions.loadData(); }
            actions.setStatsRange('week');

            if (navigator.storage && navigator.storage.persist) { navigator.storage.persist().then(isPersisted => { console.log(`持久化: ${isPersisted ? '已开启' : '未开启'}`); }); }

            // 🌟 恢复本地文件目录句柄
            actions.restoreLocalFileDirectory();

            setInterval(() => {
                store.now = new Date(); const nowIso = new Date(store.now.getTime() - (store.now.getTimezoneOffset() * 60000)).toISOString().slice(0, 16); let tasksChanged = false;
                store.tasks.forEach(t => { if (t.status === 'todo' && t.date && t.date <= nowIso) { t.status = 'doing'; actions.updateStatus(t); tasksChanged = true; } });
                if (store.currentView === 'dashboard' && store.viewDate === store.today) actions.checkScheduledTasks();
                if (tasksChanged && store.userId) actions.saveData();
            }, 60000);

            window.history.pushState('trap', null, '');
            window.addEventListener('popstate', actions.handlePopState);
        });

        return { store };
    }
});
app.mount('#app');