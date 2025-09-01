// src/utils/undo.js
class UndoStore {
  constructor(){
    this.listeners = new Set()
    this.state = { visible:false, message:'', deadline:0, timeoutId:null }
  }
  subscribe(fn){
    this.listeners.add(fn)
    fn(this.state)
    return () => this.listeners.delete(fn)
  }
  _emit(){ this.listeners.forEach(fn => fn(this.state)) }
  show(message = 'Aktion ausgeführt – rückgängig?', ms = 60000){
    this.hide()
    this.state = { visible:true, message, deadline: Date.now()+ms, timeoutId: null }
    this._emit()
    this.state.timeoutId = setTimeout(()=> this.hide(), ms)
  }
  hide(){
    if (this.state.timeoutId) clearTimeout(this.state.timeoutId)
    this.state = { visible:false, message:'', deadline:0, timeoutId:null }
    this._emit()
  }
}

export const undoStore = new UndoStore()
export const showUndo = (msg, ms) => undoStore.show(msg, ms)
export const hideUndo = () => undoStore.hide()
