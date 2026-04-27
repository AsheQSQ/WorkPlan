import { store } from './store.js';

export const utils = {
    formatDateTime(d) { return d ? d.replace('T', ' ') : ''; },
    formatTimeOnly(d) { return d && d.includes('T') ? d.split('T')[1] : ''; },
    isOverdue(t) { 
        if (!t.deadline) return false; 
        const now = new Date(store.now.getTime() - (store.now.getTimezoneOffset() * 60000)).toISOString().slice(0, 16); 
        return t.deadline < now; 
    },
    getGroupName(id) {
        if (!id) return '无';
        const g = store.groups.find(x => x.id === id);
        return g ? g.name : '无';
    },
    generateDataHash() {
        return JSON.stringify({
            t: store.tasks.map(({ expanded, ...rest }) => rest),
            tm: store.templates,
            s: store.scheduledTasks,
            g: store.groups
        });
    }
};