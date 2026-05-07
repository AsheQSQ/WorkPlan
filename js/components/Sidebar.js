import { store, getters, actions } from '../store.js';
const { toRefs } = Vue;

export default {
    template: `
        <aside class="hidden md:flex w-64 bg-white dark:bg-slate-800 border-r border-slate-200 dark:border-slate-700 flex-col z-20 shadow-lg shrink-0">
            <div class="p-6 flex items-center gap-3 border-b border-slate-100 dark:border-slate-700/50 h-16"><div class="w-8 h-8 bg-blue-600 rounded-lg flex items-center justify-center text-white shadow-md"><i class="ph ph-check-square-offset text-xl"></i></div><div class="flex-1 min-w-0"><h1 class="text-lg font-bold tracking-tight text-slate-800 dark:text-slate-100 leading-tight">PlanPro</h1><div class="text-[10px] text-slate-400 dark:text-slate-500 font-mono truncate" title="当前账号">👤 {{ accessKey }}</div></div></div>
            <div class="px-6 py-2"><div class="flex items-center gap-2 text-xs px-3 py-1.5 rounded-lg border transition-colors" :class="syncStatus.class"><i :class="syncStatus.icon"></i><span class="font-bold">{{ syncStatus.text }}</span></div></div>
            <nav class="flex-1 p-4 space-y-2">
                <button @click="switchView('dashboard')" class="w-full flex items-center gap-3 px-3 py-3 rounded-xl transition-all text-sm font-bold" :class="currentView === 'dashboard' ? 'bg-blue-50 dark:bg-blue-900/30 text-blue-700 dark:text-blue-400' : 'text-slate-600 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-700/50'"><i class="ph ph-sun text-lg"></i> 今日看板 <span v-if="activeTasks.length > 0" class="ml-auto bg-blue-600 text-white text-[10px] px-2 py-0.5 rounded-full">{{ activeTasks.length }}</span></button>
                <button @click="switchView('templates')" class="w-full flex items-center gap-3 px-3 py-3 rounded-xl transition-all text-sm font-bold" :class="currentView === 'templates' ? 'bg-purple-50 dark:bg-purple-900/30 text-purple-700 dark:text-purple-400' : 'text-slate-600 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-700/50'"><i class="ph ph-copy text-lg"></i> 任务模板</button>
                <button @click="switchView('scheduled')" class="w-full flex items-center gap-3 px-3 py-3 rounded-xl transition-all text-sm font-bold" :class="currentView === 'scheduled' ? 'bg-teal-50 dark:bg-teal-900/30 text-teal-700 dark:text-teal-400' : 'text-slate-600 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-700/50'"><i class="ph ph-clock-countdown text-lg"></i> 定时任务 <span v-if="enabledScheduledCount > 0" class="ml-auto bg-teal-100 text-teal-700 text-[10px] px-2 py-0.5 rounded-full">{{ enabledScheduledCount }}</span></button>
                <button @click="switchView('files')" class="w-full flex items-center gap-3 px-3 py-3 rounded-xl transition-all text-sm font-bold" :class="currentView === 'files' ? 'bg-amber-50 dark:bg-amber-900/30 text-amber-700 dark:text-amber-400' : 'text-slate-600 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-700/50'"><i class="ph ph-folder-open text-lg"></i> 文件管理 <span v-if="fileStats.total > 0" class="ml-auto bg-amber-100 text-amber-700 text-[10px] px-2 py-0.5 rounded-full">{{ fileStats.total }}</span></button>
                <button @click="switchView('statistics')" class="w-full flex items-center gap-3 px-3 py-3 rounded-xl transition-all text-sm font-bold" :class="currentView === 'statistics' ? 'bg-indigo-50 dark:bg-indigo-900/30 text-indigo-700 dark:text-indigo-400' : 'text-slate-600 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-700/50'"><i class="ph ph-chart-bar text-lg"></i> 数据统计</button>
            </nav>
            <div class="p-4 border-t border-slate-100 dark:border-slate-700/50 bg-slate-50 dark:bg-slate-800/50">
                <div class="text-[10px] font-bold text-slate-400 dark:text-slate-500 uppercase mb-2">系统管理</div>
                <div class="grid grid-cols-2 gap-2">
                    <button @click="toggleTheme" class="col-span-2 flex items-center justify-center gap-1 py-2 bg-white dark:bg-slate-700 border border-slate-200 dark:border-slate-600 rounded-lg text-xs text-slate-600 dark:text-slate-300 hover:text-blue-600 font-bold transition-colors"><i :class="isDarkMode ? 'ph-bold ph-sun' : 'ph-bold ph-moon'"></i> {{ isDarkMode ? '切换为浅色模式' : '切换为深色模式' }}</button>
                    <button @click="exportData" class="flex items-center justify-center gap-1 py-2 bg-white dark:bg-slate-700 border border-slate-200 dark:border-slate-600 rounded-lg text-xs text-slate-600 dark:text-slate-300 hover:text-blue-600"><i class="ph ph-download-simple"></i> 备份</button>
                    <button @click="$refs.fileInput.click()" class="flex items-center justify-center gap-1 py-2 bg-white dark:bg-slate-700 border border-slate-200 dark:border-slate-600 rounded-lg text-xs text-slate-600 dark:text-slate-300 hover:text-blue-600"><i class="ph ph-upload-simple"></i> 恢复</button>
                    <button @click="logout" class="col-span-2 flex items-center justify-center gap-1 py-2 bg-white dark:bg-slate-700 border border-red-100 dark:border-red-900/50 rounded-lg text-xs text-red-500 hover:bg-red-50 dark:hover:bg-red-900/30 font-bold"><i class="ph-bold ph-sign-out"></i> 安全退出</button>
                    <input type="file" ref="fileInput" @change="importData" class="hidden" accept=".json">
                </div>
            </div>
        </aside>

        <nav class="mobile-nav-bar md:hidden z-20">
            <button @click="switchView('dashboard')" class="mobile-nav-item" :class="currentView === 'dashboard' ? 'active' : ''"><i class="ph ph-sun"></i><span>看板</span></button>
            <button @click="switchView('templates')" class="mobile-nav-item" :class="currentView === 'templates' ? 'active' : ''"><i class="ph ph-copy"></i><span>模板</span></button>
            <button @click="switchView('scheduled')" class="mobile-nav-item" :class="currentView === 'scheduled' ? 'active' : ''"><i class="ph ph-clock-countdown"></i><span>定时</span></button>
            <button @click="switchView('files')" class="mobile-nav-item" :class="currentView === 'files' ? 'active' : ''"><i class="ph ph-folder-open"></i><span>文件</span></button>
            <button @click="switchView('statistics')" class="mobile-nav-item" :class="currentView === 'statistics' ? 'active' : ''"><i class="ph ph-chart-bar"></i><span>统计</span></button>
        </nav>
    `,
    setup() { return { ...toRefs(store), ...getters, ...actions }; }
}