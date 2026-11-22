/* Copyright (c) 2026 wayri. SPDX-License-Identifier: MPL-2.0 */
import assert from 'node:assert/strict';
import test from 'node:test';
import {createGraphicsHealth} from '../extension/spike/graphicsHealth.mjs';
import {createSceneResources} from '../extension/spike/sceneResources.mjs';

test('WebGL errors are checked only after graphics allocations change',()=>{
  let checks=0,result=0;
  const health=createGraphicsHealth({NO_ERROR:0,getError(){checks++;return result;}});
  const resources=createSceneResources({onChange:health.invalidate});
  assert.equal(health.check(),0);
  for(let frame=0;frame<50;frame++)assert.equal(health.check(),0);
  assert.equal(checks,1);
  const material={dispose(){}};
  resources.track(material);
  resources.track({dispose(){}});
  result=0x0505;
  assert.equal(health.check(),0x0505);
  resources.track(material);
  assert.equal(health.check(),0);
  assert.deepEqual(health.stats(),{checks:2,pending:false});
  resources.dispose();
});
