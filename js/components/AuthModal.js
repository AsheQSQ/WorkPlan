import { store, getters, actions } from '../store.js';
const { toRefs } = Vue;

export default {
    template: `
        <div class="fixed inset-0 z-50 flex items-center justify-center bg-slate-100/50 dark:bg-slate-900/80 backdrop-blur-sm p-4 mobile-modal-container">
            <div class="bg-white dark:bg-slate-800 p-8 rounded-2xl shadow-2xl w-full max-w-md border border-white dark:border-slate-700 mobile-bottom-sheet">
                <div class="text-center mb-6"><div class="w-16 h-16 bg-blue-600 rounded-2xl flex items-center justify-center text-white mx-auto shadow-lg mb-4 text-3xl"><i class="ph-bold ph-shield-check"></i></div><h1 class="text-2xl font-black text-slate-800 dark:text-slate-100">PlanPro Cloud</h1><p class="text-sm text-slate-500 dark:text-slate-400 mt-2">安全云端同步</p></div>
                <div class="space-y-4">
                    <div class="flex bg-slate-100 dark:bg-slate-700 p-1 rounded-xl mb-4"><button @click="isRegisterMode = false" :class="!isRegisterMode ? 'bg-white dark:bg-slate-600 shadow text-blue-600 dark:text-blue-400' : 'text-slate-500 dark:text-slate-400 hover:text-slate-700 dark:hover:text-slate-200'" class="flex-1 py-2 rounded-lg font-bold text-sm transition-all">登录</button><button @click="isRegisterMode = true" :class="isRegisterMode ? 'bg-white dark:bg-slate-600 shadow text-blue-600 dark:text-blue-400' : 'text-slate-500 dark:text-slate-400 hover:text-slate-700 dark:hover:text-slate-200'" class="flex-1 py-2 rounded-lg font-bold text-sm transition-all">注册新账号</button></div>
                    <div><label class="text-xs font-bold text-slate-400 dark:text-slate-500 uppercase ml-1">账号 (Access Key)</label><input type="text" v-model="inputKey" placeholder="输入账号" class="w-full mt-1 border-2 border-slate-100 dark:border-slate-700 rounded-xl px-4 py-3 focus:outline-none focus:border-blue-500 dark:focus:border-blue-500 transition font-mono font-bold text-slate-700 dark:text-slate-200 bg-slate-50 dark:bg-slate-900/50"></div>
                    <div><label class="text-xs font-bold text-slate-400 dark:text-slate-500 uppercase ml-1">密码 </label><input type="password" v-model="inputPassword" @keyup.enter="handleAuth" placeholder="输入密码" class="w-full mt-1 border-2 border-slate-100 dark:border-slate-700 rounded-xl px-4 py-3 focus:outline-none focus:border-blue-500 dark:focus:border-blue-500 transition font-mono font-bold text-slate-700 dark:text-slate-200 bg-slate-50 dark:bg-slate-900/50"></div>
                    <button @click="handleAuth" class="w-full bg-blue-600 text-white font-bold py-3.5 rounded-xl hover:bg-blue-700 transition shadow-lg shadow-blue-200 dark:shadow-none active:scale-95 text-lg mt-2">{{ isRegisterMode ? '注册并进入' : '登录工作台' }}</button>
                </div>
            </div>
        </div>
    `,
    setup() { return { ...toRefs(store), ...getters, ...actions }; }
}