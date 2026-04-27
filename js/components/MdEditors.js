import { store, getters, actions } from '../store.js';
const { toRefs } = Vue;

export default {
    template: `
        <div v-for="(editor, index) in openEditors" :key="editor.data.id" 
             class="fixed shadow-2xl flex flex-col bg-slate-50 dark:bg-slate-900 border border-slate-300 dark:border-slate-600 rounded-2xl overflow-hidden"
             :style="{ top: editor.y + 'px', left: editor.x + 'px', width: '600px', maxWidth: '90vw', height: '60vh', minHeight: '400px', zIndex: editor.zIndex }"
             @mousedown="bringToFront(index)">
            
            <div class="h-12 border-b border-slate-200 dark:border-slate-700 flex items-center justify-between px-4 bg-white dark:bg-slate-800 shrink-0 cursor-move" @mousedown.prevent="startDrag($event, index)">
                <input v-model="editor.data.title" type="text" placeholder="输入文档标题..." class="flex-1 bg-transparent border-none outline-none font-bold text-slate-800 dark:text-white placeholder-slate-400 text-base focus:ring-0 px-0 pointer-events-auto" @mousedown.stop>
                <button @click.stop="closeMdEditor(index)" class="text-slate-400 hover:text-red-500 ml-4 transition-colors"><i class="ph-bold ph-x text-lg"></i></button>
            </div>

            <div class="flex-1 overflow-hidden relative flex flex-col bg-white dark:bg-slate-800 pointer-events-auto">
                <div :id="'quill-editor-' + editor.data.id" class="flex-1"></div>
            </div>

            <div class="p-3 border-t border-slate-200 dark:border-slate-700 flex justify-between items-center bg-white dark:bg-slate-800 shrink-0 pointer-events-auto">
                <div class="text-[10px] text-slate-400 truncate max-w-[200px]">所属任务: {{ editor.targetTask.title }}</div>
                <div class="flex gap-2">
                    <button @click="closeMdEditor(index)" class="px-4 py-1.5 text-slate-600 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-700 rounded-lg text-xs font-bold transition-colors">取消</button>
                    <button @click="saveMdDoc(index)" class="px-5 py-1.5 bg-blue-600 text-white rounded-lg text-xs font-bold shadow hover:bg-blue-700 active:scale-95 transition-all flex items-center gap-1">
                        <i class="ph-bold ph-floppy-disk"></i> 保存
                    </button>
                </div>
            </div>
        </div>
    `,
    setup() { return { ...toRefs(store), ...getters, ...actions }; }
}