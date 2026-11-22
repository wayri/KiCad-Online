/* Copyright (c) 2026 wayri. SPDX-License-Identifier: MPL-2.0 */
/** Probe new graphics allocations without synchronizing the GPU on steady frames. */
export function createGraphicsHealth(gl) {
  let pending=true,checks=0;
  return {
    invalidate(){pending=true;},
    check(){
      if(!pending)return gl.NO_ERROR;
      pending=false;
      checks++;
      return gl.getError();
    },
    stats:()=>({checks,pending})
  };
}
