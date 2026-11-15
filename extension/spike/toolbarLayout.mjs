/** Keep one set of 3D controls while changing their narrow-host presentation. */
export function mountCompactToolbar({host,moreButton,panel,Observer=ResizeObserver,threshold=520,force=false}){
 let compact=null;
 const setOpen=open=>{panel.hidden=compact&& !open;moreButton.setAttribute('aria-expanded',String(Boolean(compact&&open)));};
 const update=width=>{const next=force||width<threshold;if(next===compact)return;compact=next;host.dataset.compact=String(compact);moreButton.hidden=!compact;setOpen(false);};
 const observer=new Observer(entries=>update(entries[0].contentRect.width));observer.observe(host);
 update(host.getBoundingClientRect().width);
 return {get compact(){return compact;},get open(){return compact&&!panel.hidden;},toggle(){if(compact)setOpen(panel.hidden);},close(){if(compact)setOpen(false);},dispose(){observer.disconnect();}};
}
