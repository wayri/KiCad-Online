"use strict";

// Privileged GitHub write API. This file is loaded only by the extension worker.
const KiCadGitHubReviewApi = (() => {
  const REPOSITORY = /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/;
  const NUMBER = (value) => Number.isSafeInteger(value) && value > 0;
  const API = "https://api.github.com";
  const TOKEN_KEY = "github-review-token";
  const TOKEN_EXPIRY_KEY = "github-review-token-expiry";
  const CLIENT_ID_KEY = "github-oauth-client-id";
  const DEVICE_KEY = "github-device-pending";
  const CLIENT_ID = /^[A-Za-z0-9_]{10,100}$/;
  // Publisher configuration: the OAuth App's public client ID, never its secret.
  // Public client ID for wayri's registered OAuth App; Device Flow is required.
  const RELEASE_OAUTH_CLIENT_ID = "Ov23li8RsSVZk2dHptN1";
  const DEVICE_SCOPES = new Set(["public_repo", "repo", "public_repo project", "repo project"]);
  const DESTINATIONS = new Set(["new-issue", "issue", "new-discussion", "discussion"]);
  const validRepository = (value) => typeof value === "string" && REPOSITORY.test(value) &&
    value.split("/").every((part) => part !== "." && part !== "..");
  const validId = (value) => typeof value === "string" && /^[A-Za-z0-9_+\/=.-]{1,200}$/.test(value);
  const fail = (message, definitive = false) => Object.assign(new Error(message), { definitive });

  // Chrome keys survive background sleeps in the isolated offscreen worker.
  // Unsupported browsers retain the in-memory background-key fallback.
  const sessionVault = typeof KiCadCredentialVault !== "undefined" && KiCadCredentialVault.supported ? KiCadCredentialVault.forProvider("github") : null;
  let vaultKey = null, deviceSecret = null, authEpoch = 0, authQueue = Promise.resolve(), initialized = false;
  let disconnectReason = '';
  const SESSION_LIMIT = 8 * 60 * 60 * 1000;
  function authOperation(operation) {
    if (!initialized) {
      initialized = true;
      authQueue = authQueue.then(async () => {
        const record = (await chrome.storage.session.get(TOKEN_KEY))[TOKEN_KEY];
        const recoverable = record?.version === 2 && sessionVault && await sessionVault.hasKey().catch(() => false);
        if (!recoverable && (record || (await chrome.storage.session.get(DEVICE_KEY))[DEVICE_KEY])) disconnectReason = 'background-restarted';
        await chrome.storage.session.remove([TOKEN_EXPIRY_KEY, DEVICE_KEY, ...(!recoverable ? [TOKEN_KEY] : [])]);
        await chrome.storage.local.remove([TOKEN_KEY, TOKEN_EXPIRY_KEY, DEVICE_KEY]);
      });
    }
    const result = authQueue.then(operation);
    authQueue = result.catch(() => {});
    return result;
  }
  async function readCredential() {
    await globalThis.KiCadManagedPolicy?.assertNetwork();
    const record = (await chrome.storage.session.get(TOKEN_KEY))[TOKEN_KEY];
    if (!record) return null;
    try {
      if (sessionVault) return { token: await sessionVault.decrypt(record), expiresAt: record.expiresAt };
      if (!vaultKey || record.version !== 1 || !Number.isFinite(record.expiresAt) ||
          record.expiresAt <= Date.now() || !Array.isArray(record.iv) || record.iv.length !== 12 ||
          !Array.isArray(record.ciphertext) || record.ciphertext.length > 1024 ||
          ![...record.iv, ...record.ciphertext].every(n => Number.isInteger(n) && n >= 0 && n <= 255)) throw new Error("locked");
      const bytes = await crypto.subtle.decrypt({ name: "AES-GCM", iv: new Uint8Array(record.iv),
        additionalData: new TextEncoder().encode(`github-token:v1:${record.expiresAt}`) }, vaultKey,
        new Uint8Array(record.ciphertext));
      const token = new TextDecoder().decode(bytes);
      new Uint8Array(bytes).fill(0);
      return { token, expiresAt: record.expiresAt };
    } catch {
      disconnectReason = record.expiresAt <= Date.now() ? 'expired' : 'session-locked';
      vaultKey = null;
      await chrome.storage.session.remove([TOKEN_KEY, TOKEN_EXPIRY_KEY]);
      if (sessionVault) await sessionVault.clear().catch(() => {});
      return null;
    }
  }
  async function tokenStatus() {
    return authOperation(async () => {
      const credential = await readCredential();
      return credential ? { configured: true, expiresAt: credential.expiresAt } :
        { configured: false, ...(disconnectReason ? { reason: disconnectReason } : {}) };
    });
  }
  async function setToken(value, lifetime = SESSION_LIMIT, expectedEpoch) {
    await globalThis.KiCadManagedPolicy?.assertNetwork();
    if (typeof value !== "string" || value.length < 20 || value.length > 500 || /[^\x21-\x7e]/.test(value)) {
      throw fail("Enter a valid GitHub access token (20–500 printable characters, no spaces).", true);
    }
    const manual = expectedEpoch === undefined;
    if (manual) expectedEpoch = ++authEpoch;
    return authOperation(async () => {
      if (expectedEpoch !== authEpoch) throw fail("Sign-in was cancelled. Start again.", true);
      if (manual) {
        deviceSecret = null;
        await chrome.storage.session.remove(DEVICE_KEY);
      }
      if (chrome.storage.session.setAccessLevel) {
        await chrome.storage.session.setAccessLevel({ accessLevel: "TRUSTED_CONTEXTS" });
      }
      const expiresAt = Date.now() + Math.min(SESSION_LIMIT, Number.isFinite(lifetime) && lifetime > 0 ? lifetime : SESSION_LIMIT);
      let record;
      if (sessionVault) record = await sessionVault.encrypt(value, expiresAt);
      else {
        const key = await crypto.subtle.generateKey({ name: "AES-GCM", length: 256 }, false, ["encrypt", "decrypt"]);
        const iv = crypto.getRandomValues(new Uint8Array(12)), bytes = new TextEncoder().encode(value);
        let ciphertext;
        try { ciphertext = await crypto.subtle.encrypt({ name: "AES-GCM", iv,
          additionalData: new TextEncoder().encode(`github-token:v1:${expiresAt}`) }, key, bytes); }
        finally { bytes.fill(0); }
        vaultKey = key;
        record = { version: 1, iv: Array.from(iv), ciphertext: Array.from(new Uint8Array(ciphertext)), expiresAt };
      }
      if (expectedEpoch !== authEpoch) {
        vaultKey = null;
        if (sessionVault) await sessionVault.clear();
        throw fail("Sign-in was cancelled. Start again.", true);
      }
      disconnectReason = '';
      await chrome.storage.session.set({ [TOKEN_KEY]: record });
      await chrome.storage.session.remove(TOKEN_EXPIRY_KEY);
      if (expectedEpoch !== authEpoch) {
        vaultKey = null;
        await chrome.storage.session.remove([TOKEN_KEY, TOKEN_EXPIRY_KEY]);
        if (sessionVault) await sessionVault.clear();
        throw fail("Sign-in was cancelled. Start again.", true);
      }
      return { configured: true, expiresAt };
    });
  }
  async function clearToken(reset = false) {
    authEpoch++;
    return authOperation(async () => {
      vaultKey = null;
      deviceSecret = null;
      disconnectReason = reset ? 'reset' : 'signed-out';
      await chrome.storage.session.remove([TOKEN_KEY, TOKEN_EXPIRY_KEY, DEVICE_KEY]);
      if (reset) await chrome.storage.local.remove(CLIENT_ID_KEY);
      if (sessionVault) await sessionVault.clear();
      return { configured: false };
    });
  }
  async function getToken() {
    return authOperation(async () => {
      const credential = await readCredential();
      if (!credential) throw fail("GitHub session is locked or expired. Sign in again in extension settings.", true);
      return credential.token;
    });
  }
  async function resetAuth() { return clearToken(true); }
  async function finishDevice(pending, epoch) {
    return authOperation(async () => {
      const current = (await chrome.storage.session.get(DEVICE_KEY))[DEVICE_KEY];
      if (epoch !== authEpoch || current?.nonce !== pending.nonce) return false;
      deviceSecret = null;
      await chrome.storage.session.remove(DEVICE_KEY);
      return true;
    });
  }
  async function assertCurrentToken(token, epoch = authEpoch) {
    const current = await getToken();
    if (epoch !== authEpoch || current !== token) throw fail("GitHub account changed or signed out. Try again after signing in.", true);
  }
  async function authorizationHeaders() {
    return authOperation(async () => {
      const credential = await readCredential();
      return credential ? { Authorization: `Bearer ${credential.token}` } : {};
    });
  }

  async function deviceHttp(path, fields) {
    await globalThis.KiCadManagedPolicy?.assertNetwork();
    if (path !== "/login/device/code" && path !== "/login/oauth/access_token") throw fail("Invalid GitHub authorization path.", true);
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 30000);
    let response;
    try {
      response = await fetch(`https://github.com${path}`, {
        method: "POST", headers: { Accept: "application/json", "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams(fields).toString(), credentials: "omit", cache: "no-store",
        redirect: "error", signal: controller.signal
      });
    } catch { throw fail("GitHub sign-in could not be reached. Try again later.", true); }
    finally { clearTimeout(timeout); }
    if (!response.ok) throw fail(`GitHub sign-in returned HTTP ${response.status}.`, true);
    try {
      const text = await response.text();
      if (text.length > 16384) throw new Error("oversize");
      return JSON.parse(text);
    } catch { throw fail("GitHub returned an unreadable sign-in response.", true); }
  }
  const safeFlow = (pending) => ({ userCode: pending.userCode,
    verificationUrl: "https://github.com/login/device", expiresAt: pending.expiresAt,
    retryAfterMs: Math.max(0, pending.nextPollAt - Date.now()), intervalSeconds: pending.intervalSeconds,
    scope: pending.scope || "public_repo" });
  async function deviceStatus() {
    await authOperation(async () => {});
    const epoch = authEpoch;
    const customClientId = (await chrome.storage.local.get(CLIENT_ID_KEY))[CLIENT_ID_KEY] || "";
    const clientId = customClientId || RELEASE_OAUTH_CLIENT_ID;
    const configuration = { clientId, customClientId, releaseConfigured: Boolean(RELEASE_OAUTH_CLIENT_ID) };
    const pending = (await chrome.storage.session.get(DEVICE_KEY))[DEVICE_KEY];
    if (pending && Date.now() >= pending.expiresAt) {
      await finishDevice(pending, epoch);
      return { ...configuration, active: false, expired: true };
    }
    return { ...configuration, active: Boolean(pending), ...(pending ? safeFlow(pending) : {}),
      ...(disconnectReason ? { reason: disconnectReason } : {}) };
  }
  async function startDevice(value = "", scope = "public_repo") {
    const epoch = authEpoch;
    if (!DEVICE_SCOPES.has(scope)) throw fail("Choose public repositories or public and private repositories, optionally with Projects access.", true);
    if (typeof value !== "string") throw fail("Invalid GitHub OAuth App configuration.", true);
    value = value.trim() || RELEASE_OAUTH_CLIENT_ID;
    if (!value) throw fail("GitHub sign-in is not configured in this build. The publisher must register an OAuth App with Device Flow enabled. Local review and GitHub draft links still work; advanced setup is available below.", true);
    if (!CLIENT_ID.test(value)) throw fail("Enter the registered GitHub OAuth App client ID.", true);
    const current = await deviceStatus();
    if (current.active) throw fail("A GitHub sign-in is already in progress. Cancel it before starting another.", true);
    const data = await deviceHttp("/login/device/code", { client_id: value, scope });
    if (data.error) throw fail("GitHub rejected the OAuth App client ID or device flow is disabled.", true);
    if (typeof data.device_code !== "string" || !/^[A-Za-z0-9_-]{20,200}$/.test(data.device_code) ||
        typeof data.user_code !== "string" || !/^[A-Z0-9-]{4,30}$/.test(data.user_code) ||
        data.verification_uri !== "https://github.com/login/device" ||
        !Number.isInteger(data.expires_in) || data.expires_in < 30 || data.expires_in > 1800 ||
        !Number.isInteger(data.interval) || data.interval < 1 || data.interval > 300) {
      throw fail("GitHub returned an invalid device authorization response.", true);
    }
    const now = Date.now();
    const pending = { clientId: value, scope, userCode: data.user_code,
      expiresAt: now + data.expires_in * 1000, intervalSeconds: Math.max(5, data.interval),
      nextPollAt: now + Math.max(5, data.interval) * 1000,
      nonce: crypto.randomUUID() };
    if (chrome.storage.session.setAccessLevel) {
      await chrome.storage.session.setAccessLevel({ accessLevel: "TRUSTED_CONTEXTS" });
    }
    if (epoch !== authEpoch) return { state: "cancelled" };
    await authOperation(async () => {
      if (epoch !== authEpoch) throw fail("Sign-in was cancelled. Start again.", true);
      if ((await chrome.storage.session.get(DEVICE_KEY))[DEVICE_KEY]) throw fail("A GitHub sign-in is already in progress.", true);
      await chrome.storage.local.set({ [CLIENT_ID_KEY]: value });
      deviceSecret = data.device_code;
      await chrome.storage.session.set({ [DEVICE_KEY]: pending });
    });
    return { state: "pending", ...safeFlow(pending) };
  }
  async function cancelDevice() {
    authEpoch++;
    await authOperation(async () => {
      deviceSecret = null;
      await chrome.storage.session.remove(DEVICE_KEY);
    });
    return { state: "cancelled" };
  }
  let pollLock = null;
  async function pollDevice() {
    if (pollLock) return pollLock;
    pollLock = pollDeviceOnce();
    try { return await pollLock; } finally { pollLock = null; }
  }
  async function pollDeviceOnce() {
    await authOperation(async () => {});
    const epoch = authEpoch;
    const pending = (await chrome.storage.session.get(DEVICE_KEY))[DEVICE_KEY];
    const secret = deviceSecret;
    if (!pending || !secret) throw fail("No GitHub sign-in is in progress.", true);
    const now = Date.now();
    if (now >= pending.expiresAt) {
      await finishDevice(pending, epoch);
      return { state: "expired" };
    }
    if (now < pending.nextPollAt) return { state: "pending", ...safeFlow(pending) };
    pending.nextPollAt = now + pending.intervalSeconds * 1000;
    await authOperation(async () => {
      if (epoch === authEpoch) await chrome.storage.session.set({ [DEVICE_KEY]: pending });
    });
    if (epoch !== authEpoch) return { state: "cancelled" };
    const data = await deviceHttp("/login/oauth/access_token", { client_id: pending.clientId,
      device_code: secret, grant_type: "urn:ietf:params:oauth:grant-type:device_code" });
    const current = (await chrome.storage.session.get(DEVICE_KEY))[DEVICE_KEY];
    if (epoch !== authEpoch || current?.nonce !== pending.nonce) return { state: "cancelled" };
    if (Date.now() >= current.expiresAt) {
      await finishDevice(pending, epoch);
      return { state: "expired" };
    }
    if (data.access_token) {
      const granted = typeof data.scope === "string" ? data.scope.split(/[\s,]+/) : [];
      const requested = pending.scope || "public_repo", privateScope=requested.split(' ').includes('repo'), projectsScope=requested.split(' ').includes('project');
      if (data.token_type?.toLowerCase() !== "bearer" ||
          !(privateScope ? granted.includes("repo") : granted.includes("public_repo") || granted.includes("repo")) || projectsScope&&!granted.includes('project')) {
        await finishDevice(pending, epoch);
        throw fail(`GitHub did not grant ${privateScope ? "private" : "public"} repository access${projectsScope?' and Projects access':''}. Start sign-in again and approve that scope.`, true);
      }
      await setToken(data.access_token, Number.isInteger(data.expires_in) && data.expires_in > 0 ?
        data.expires_in * 1000 : SESSION_LIMIT, epoch);
      if (!(await finishDevice(pending, epoch))) return { state: "cancelled" };
      return { state: "connected" };
    }
    if (data.error === "authorization_pending") return { state: "pending", ...safeFlow(current) };
    if (data.error === "slow_down") {
      current.intervalSeconds = Math.min(300, Math.max(current.intervalSeconds + 5,
        Number.isInteger(data.interval) ? data.interval : 0));
      current.nextPollAt = Date.now() + current.intervalSeconds * 1000;
      await authOperation(async () => {
        if (epoch === authEpoch) await chrome.storage.session.set({ [DEVICE_KEY]: current });
      });
      return { state: "pending", ...safeFlow(current), slowedDown: true };
    }
    await finishDevice(pending, epoch);
    if (data.error === "access_denied") return { state: "denied" };
    if (data.error === "expired_token") return { state: "expired" };
    throw fail(data.error === "device_flow_disabled" ? "Enable Device Flow in the registered OAuth App settings." :
      "GitHub sign-in failed. Check the OAuth App client ID and start again.", true);
  }

  async function request(path, token, body, epoch = authEpoch, method, forkOptions) {
    if (typeof path !== "string" || !path.startsWith("/repos/") && path !== "/graphql" && !(forkOptions && (path === '/user' || /^\/user\/memberships\/orgs\/[A-Za-z0-9-]+$/.test(path))) ||
        path.includes("//") || path.includes("..")) throw fail("Invalid GitHub API path.", true);
    await assertCurrentToken(token, epoch);
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 30000);
    let response;
    try {
      response = await fetch(API + path, {
        method: method || (body === undefined ? "GET" : "POST"),
        headers: { Accept: "application/vnd.github+json", "Content-Type": "application/json",
          "X-GitHub-Api-Version": "2022-11-28", Authorization: `Bearer ${token}` },
        body: body === undefined ? undefined : JSON.stringify(body),
        credentials: "omit", cache: "no-store", redirect: "error", signal: controller.signal
      });
    } catch {
      throw fail("GitHub did not confirm the request. Publishing may have succeeded; inspect the thread before retrying.");
    } finally { clearTimeout(timeout); }
    if (forkOptions && response.status === 404) return {status:404,data:null};
    if (!response.ok) {
      if (response.status === 401 || response.status === 403) throw fail("GitHub denied access. Check the token and repository permissions.", true);
      if (response.status === 404) throw fail("GitHub repository or thread was not found, or token access is missing.", true);
      if (response.status === 422 || response.status === 410 || response.status === 400) throw fail("GitHub rejected this issue or discussion request.", true);
      if (response.status === 429) throw fail("GitHub rate limited this request; inspect the thread before retrying.");
      throw fail(`GitHub returned HTTP ${response.status}; inspect the thread before retrying.`);
    }
    try {
      let data;
      if(forkOptions){
        if(Number(response.headers.get('content-length'))>1024*1024||!response.body?.getReader)throw fail('Provider response cannot be read within its size limit.',!forkOptions.stateChange);
        const reader=response.body.getReader(),chunks=[],readTimer=setTimeout(()=>controller.abort(),30000);let size=0;
        try{for(;;){const item=await reader.read();if(item.done)break;size+=item.value.byteLength;if(size>1024*1024){await reader.cancel();throw fail('Provider response exceeds its size limit.',!forkOptions.stateChange);}chunks.push(item.value);}}
        finally{clearTimeout(readTimer);reader.releaseLock();}
        const bytes=new Uint8Array(size);let offset=0;for(const chunk of chunks){bytes.set(chunk,offset);offset+=chunk.length;}data=JSON.parse(new TextDecoder().decode(bytes));
        await assertCurrentToken(token,epoch);
      }else data = await response.json();
      if (path === "/graphql" && Array.isArray(data.errors) && data.errors.length) {
        throw fail("GitHub rejected or did not confirm the discussion request. Check token permissions and inspect the thread.",
          !body?.query?.includes("mutation"));
      }
      return forkOptions ? {status:response.status,data} : data;
    } catch (error) {
      if (error.definitive) throw error;
      throw fail("GitHub returned an unreadable response; inspect the thread before retrying.");
    }
  }
  const graphql = (token, query, variables, epoch = authEpoch) => request("/graphql", token, { query, variables }, epoch);
  async function forkRevision(message){
    KiCadRevisionFork.validate({...message,provider:'github'});
    await globalThis.KiCadManagedPolicy?.assertWrites();
    const epoch=authEpoch,token=await getToken();
    await KiCadReviewComments.reservePublication(chrome.storage.local,JSON.stringify(['github','https://github.com']),Date.now());
    return KiCadRevisionFork.create({...message,provider:'github'},{
      authorize:async()=>{await globalThis.KiCadManagedPolicy?.assertWrites();await assertCurrentToken(token,epoch);},
      request:(method,path,body)=>request(path,token,body,epoch,method,true)
    });
  }
  function repoParts(repository) {
    if (!validRepository(repository)) throw fail("Invalid target GitHub repository.", true);
    return repository.split("/");
  }
  async function categoryBundle(repository) {
    const [owner, name] = repoParts(repository), token = await getToken();
    const data = await graphql(token, `query($owner:String!,$name:String!){repository(owner:$owner,name:$name){id discussionCategories(first:25){nodes{id name slug description}}}}`, { owner, name });
    const repo = data.data?.repository;
    if (!validId(repo?.id) || !Array.isArray(repo.discussionCategories?.nodes)) {
      throw fail("GitHub Discussions are unavailable for this repository.", true);
    }
    return { repositoryId: repo.id, categories: repo.discussionCategories.nodes.filter((item) => validId(item?.id))
      .map(({ id, name, slug, description }) => ({ id, name, slug, description })) };
  }
  async function categories(repository) { return (await categoryBundle(repository)).categories; }

  // Readback keeps one account identity for the entire paginated operation.
  async function readbackSession(optional = false) {
    await authOperation(async () => {});
    const epoch = authEpoch;
    const credential = await authOperation(readCredential);
    const token = credential?.token;
    if (!optional && !token) throw fail("Sign in to GitHub to read Discussion review comments.", true);
    const check = async () => {
      if (epoch !== authEpoch) throw fail("GitHub account changed or signed out. Refresh review comments.", true);
      if (token) await assertCurrentToken(token, epoch);
    };
    await check();
    return { token, epoch, check };
  }
  const readbackCache = new Map();
  async function readbackJson(url, session, body) {
    await session.check();
    const cacheKey=JSON.stringify([session.epoch,!!session.token,url]),cached=body===undefined?readbackCache.get(cacheKey):null;
    const controller = new AbortController(), timeout = setTimeout(() => controller.abort(), 30000);
    try {
      const response = await fetch(url, { method: body === undefined ? "GET" : "POST",
        headers: { Accept: "application/vnd.github+json", "X-GitHub-Api-Version": "2022-11-28",
          ...(body === undefined ? {} : { "Content-Type": "application/json" }),
          ...(session.token ? { Authorization: `Bearer ${session.token}` } : {}),
          ...(cached ? { "If-None-Match": cached.etag } : {}) },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
        credentials: "omit", cache: "no-store", redirect: "error", signal: controller.signal });
      await session.check();
      if(response.status===304&&cached)return JSON.parse(cached.text);
      if (response.status === 429 || response.status === 403 && response.headers.get('x-ratelimit-remaining') === '0') throw fail("GitHub API rate limit reached. Wait before refreshing review comments.", true);
      if (!response.ok) throw fail(`GitHub review readback returned HTTP ${response.status}. Check repository and account access.`, true);
      if (Number(response.headers.get("content-length")) > 4 * 1024 * 1024) throw fail("GitHub review response exceeds the 4 MiB limit.", true);
      if (!response.body?.getReader) throw fail("GitHub review response cannot be read safely.", true);
      const reader = response.body.getReader(), chunks = []; let length = 0;
      try {
        for (;;) {
          const { done, value } = await reader.read();
          await session.check();
          if (done) break;
          length += value.byteLength;
          if (length > 4 * 1024 * 1024) throw fail("GitHub review response exceeds the 4 MiB limit.", true);
          chunks.push(value);
        }
      } catch (error) { await reader.cancel().catch(() => {}); throw error; }
      const bytes = new Uint8Array(length); let offset = 0;
      for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
      const text = new TextDecoder().decode(bytes), result = JSON.parse(text);
      await session.check();
      if (Array.isArray(result?.errors) && result.errors.length) throw fail("GitHub denied or could not complete Discussion readback.", true);
      const etag=response.headers.get('etag');
      if(body===undefined&&typeof etag==='string'&&etag.length<=1024&&bytes.length<=262144){readbackCache.delete(cacheKey);readbackCache.set(cacheKey,{etag,text});if(readbackCache.size>16)readbackCache.delete(readbackCache.keys().next().value);}
      return result;
    } catch (error) {
      if (error.definitive) throw error;
      throw fail("GitHub review comments could not be read. Try refreshing later.", true);
    } finally { clearTimeout(timeout); }
  }
  async function createAnnotationReader() {
    const session = await readbackSession(true);
    return async path => {
      if (typeof path !== "string" || !/^\/repos\/[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+\/issues(?:\/[1-9]\d*(?:\/comments)?)?(?:\?[^#]*)?$/.test(path)) throw fail("Invalid GitHub review readback path.", true);
      const parts = path.split('?')[0].split('/'), url = new URL(API + path);
      if (!validRepository(`${parts[2]}/${parts[3]}`) || (parts[5] && !NUMBER(Number(parts[5])))) throw fail("Invalid GitHub review readback path.", true);
      const seen = new Set();
      for (const [key, value] of url.searchParams) {
        if (seen.has(key) || !(key === 'state' && ['all','open','closed'].includes(value) || key === 'per_page' && /^(?:[1-9]\d?|100)$/.test(value) || key === 'page' && /^(?:[1-9]|10)$/.test(value))) throw fail("Invalid GitHub review readback query.", true);
        seen.add(key);
      }
      return readbackJson(url.href, session);
    };
  }

  // Conversation source identifiers are retained for server-verified chat mutations.
  const readCapabilityCache=new Map();let capabilityGeneration=0;
  function invalidateReadCapabilities(){capabilityGeneration++;readCapabilityCache.clear();}
  async function readThread({repository,ref,file,kind,number,provider,includeCapabilities=false}={}) {
    const scope=KiCadReviewComments.normalizeScope({repository,ref,file,provider});
    if(scope.provider==='gitlab'||!['issue','discussion'].includes(kind)||!NUMBER(number))throw fail('Invalid GitHub thread request.',true);
    const [owner,name]=repoParts(repository), session=await readbackSession(kind==='issue');
    const warnings=[],comments=[],seen=new Set();let requests=0,characters=0,stopped=false;
    const warn=m=>{if(!warnings.includes(m))warnings.push(m);};
    const timestamp=v=>typeof v==='string'&&/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d{1,3})?Z$/.test(v)&&Number.isFinite(Date.parse(v));
    const url=`https://github.com/${repository}/${kind==='issue'?'issues':'discussions'}/${number}`;
    const text=v=>{
      if(v===null||v===undefined)return '';
      if(typeof v!=='string')throw fail('GitHub returned an invalid thread body.',true);
      const available=Math.max(0,1024*1024-characters),limit=Math.min(65536,available);
      if(v.length>limit)warn('Thread text was truncated at 64 KiB per entry or 1 MiB total.');
      const encoded=new TextEncoder().encode(v), result=new TextDecoder().decode(encoded.slice(0,limit),{stream:true});if(encoded.length>limit)warn('Thread text was truncated at 64 KiB per entry or 1 MiB total.');characters+=Math.min(encoded.length,limit);if(characters>=1024*1024)stopped=true;return result;
    };
    const record=(v,root=false,parentId)=>{
      const id=kind==='issue'?v?.id:v?.databaseId;
      const createdAt=kind==='issue'?v?.created_at:v?.createdAt,updatedAt=kind==='issue'?v?.updated_at:v?.updatedAt;
      const author=kind==='issue'?v?.user:v?.author;
      if(!v||(!root&&!NUMBER(id))||!timestamp(createdAt)||!timestamp(updatedAt)||author!==null&&!LOGIN.test(author?.login||'')){
        if(root)throw fail('GitHub returned invalid thread provenance.',true);
        warn('Some thread comments had invalid provenance and were omitted.');return null;
      }
      const body=text(v.body),bodyTruncated=body!==(v.body||'');
      return {id:root?String(number):String(id),author:author?.login||null,createdAt,updatedAt,body,bodyTruncated,url:root?url:url+(kind==='issue'?`#issuecomment-${id}`:`#discussioncomment-${id}`),replyTo:parentId||null,nodeId:validId(kind==='issue'?v.node_id:v.id)?(kind==='issue'?v.node_id:v.id):null,canEdit:false,canReply:!root,viewerCanUpdate:v.viewerCanUpdate===true,viewerDidAuthor:v.viewerDidAuthor===true};
    };
    const add=(v,parentId)=>{if(comments.length>=200||stopped){stopped=true;return;}const r=record(v,false,parentId);if(r&&!seen.has(r.id)){seen.add(r.id);comments.push(r);}};
    let thread;
    if(kind==='issue'){
      const endpoint=`${API}/repos/${repository}/issues/${number}`;
      const value=await readbackJson(endpoint,session);requests++;
      if(value?.number!==number||!['open','closed'].includes(value.state)||typeof value.title!=='string'||!Number.isSafeInteger(value.comments)||value.comments<0)throw fail('GitHub returned an invalid Issue response.',true);
      thread={kind,number,title:value.title.slice(0,1024),state:value.state,isPullRequest:!!value.pull_request,locked:value.locked===true,...record(value,true)};
      const firstPage=Math.max(1,Math.ceil(value.comments/50)-3);if(firstPage>1)warn('Issue history was truncated; showing the most recent available comment pages.');
      for(let page=firstPage;comments.length<200&&!stopped&&(page-1)*50<value.comments;page++){
        const values=await readbackJson(`${endpoint}/comments?per_page=50&page=${page}`,session);requests++;
        if(!Array.isArray(values)||values.length>50)throw fail('GitHub returned an invalid Issue comment response.',true);
        for(const v of values)add(v);
        if(values.length<50){if(page*50<value.comments)warn('Issue pagination ended early; some comments may be missing.');break;}
        if(page-firstPage>=3){if(value.comments>page*50)stopped=true;break;}
      }
    }else{
      const fields='id databaseId body createdAt updatedAt author{login} viewerCanUpdate viewerDidAuthor';
      const query=`query($owner:String!,$name:String!,$number:Int!,$cursor:String){repository(owner:$owner,name:$name){discussion(number:$number){number title closed locked ${fields} comments(first:50,after:$cursor){nodes{${fields} replies(first:10){nodes{${fields}} pageInfo{hasNextPage endCursor}}} pageInfo{hasNextPage endCursor}}}}}`;
      const replyQuery=`query($id:ID!,$cursor:String){node(id:$id){... on DiscussionComment{replies(first:50,after:$cursor){nodes{${fields}} pageInfo{hasNextPage endCursor}}}}}`;
      const next=(p,previous)=>{if(!p||typeof p.hasNextPage!=='boolean'){warn('Thread pagination was incomplete.');return null;}if(!p.hasNextPage)return null;if(typeof p.endCursor!=='string'||p.endCursor.length>1024||!p.endCursor||/[\x00-\x1f]/.test(p.endCursor)||p.endCursor===previous){warn('Thread pagination was invalid.');return null;}return p.endCursor;};
      const replies=[],cursors=new Set();let cursor=null;
      do{
        const result=await readbackJson(API+'/graphql',session,{query,variables:{owner,name,number,cursor}});requests++;
        const value=result.data?.repository?.discussion;
        if(value?.number!==number||typeof value.title!=='string'||typeof value.closed!=='boolean'||!Array.isArray(value.comments?.nodes)||value.comments.nodes.length>50)throw fail('GitHub returned an invalid Discussion response.',true);
        if(!thread)thread={kind,number,title:value.title.slice(0,1024),state:value.closed?'closed':'open',locked:value.locked===true,...record(value,true)};
        for(const v of value.comments.nodes){add(v);if(stopped)break;if(!Array.isArray(v?.replies?.nodes)||v.replies.nodes.length>10){warn('Some Discussion replies were unavailable.');continue;}for(const r of v.replies.nodes)add(r,String(v.databaseId));const r=next(v.replies.pageInfo,null);if(r&&validId(v.id)&&NUMBER(v.databaseId))replies.push({id:v.id,parentId:String(v.databaseId),cursor:r});else if(r)warn('Some Discussion replies had invalid identifiers.');}
        cursor=next(value.comments.pageInfo,cursor);if(cursor&&cursors.has(cursor)){warn('Thread pagination repeated.');cursor=null;}if(cursor)cursors.add(cursor);
      }while(cursor&&!stopped&&requests<10);
      if(cursor)stopped=true;
      for(const task of replies){const visited=new Set();do{
        if(stopped||requests>=10){stopped=true;break;}if(visited.has(task.cursor)){warn('Reply pagination repeated.');break;}visited.add(task.cursor);
        const result=await readbackJson(API+'/graphql',session,{query:replyQuery,variables:{id:task.id,cursor:task.cursor}});requests++;
        const page=result.data?.node?.replies;if(!Array.isArray(page?.nodes)||page.nodes.length>50)throw fail('GitHub returned an invalid Discussion reply response.',true);
        for(const v of page.nodes)add(v,task.parentId);task.cursor=next(page.pageInfo,task.cursor);
      }while(task.cursor);if(stopped)break;}
    }
    if(stopped)warn('Thread readback was truncated at 200 comments, 10 requests or the text limit. Open the remote thread for the complete conversation.');
    const capabilityKey=JSON.stringify([session.epoch,capabilityGeneration,repository.toLowerCase(),kind,number,thread.updatedAt,thread.state,thread.locked,thread.isPullRequest]),cached=includeCapabilities&&session.token?readCapabilityCache.get(capabilityKey):null;
    const reused=cached&&Date.now()-cached.at<30000;
    let allowed=reused?cached.allowed:false,login=reused?cached.login:null;
    if(includeCapabilities&&session.token&&!reused){try{const policy=await commentPolicyStatus(repository);allowed=policy.allowed===true;login=policy.login||null;}catch{warn('Chat permissions could not be verified.');}}
    allowed=allowed&&LOGIN.test(login||'')&&!thread.locked&&!thread.isPullRequest;
    for(const comment of comments)comment.canEdit=allowed&&!!login&&comment.author?.toLowerCase()===login.toLowerCase()&&(kind==='issue'||comment.viewerCanUpdate&&comment.viewerDidAuthor)&&!comment.bodyTruncated&&!comment.body.includes('kicad-review:');
    let canClose=reused?cached.canClose:false,canReopen=reused?cached.canReopen:false;
    if(allowed&&includeCapabilities&&!reused){try{await globalThis.KiCadManagedPolicy?.assertWrites();const state=await threadStateSnapshot(repository,kind,number,session.token,authEpoch);if(state.updatedAt===thread.updatedAt&&state.closed===(thread.state==='closed')){canClose=!state.closed&&state.viewerCanClose;canReopen=state.closed&&state.viewerCanReopen;}}catch{warn('Conversation state permissions could not be verified.');}}
    await session.check();if(includeCapabilities&&session.token&&!reused){readCapabilityCache.set(capabilityKey,{at:Date.now(),allowed,login,canClose,canReopen});if(readCapabilityCache.size>32)readCapabilityCache.delete(readCapabilityCache.keys().next().value);}return {...thread,comments,warnings,capabilities:{canClose,canReopen,create:allowed,reply:allowed,edit:allowed,reactions:false,replyMode:kind==='issue'?'quoted':'native'}};
  }

  const threadStateGraphql=async(token,query,variables,current)=>(await request('/graphql',token,{query,variables},current,undefined,{stateChange:true})).data;
  async function threadStateSnapshot(repository,kind,number,token,current) {
    const [owner,name]=repository.split('/');
    const result=await threadStateGraphql(token,`query($owner:String!,$name:String!,$number:Int!){repository(owner:$owner,name:$name){nameWithOwner ${kind}(number:$number){id number closed updatedAt viewerCanClose viewerCanReopen}}}`,{owner,name,number},current);
    const repo=result.data?.repository,value=repo?.[kind];
    if(repo?.nameWithOwner?.toLowerCase()!==repository.toLowerCase()||!validId(value?.id)||value.number!==number||typeof value.closed!=='boolean'||typeof value.updatedAt!=='string'||!Number.isFinite(Date.parse(value.updatedAt))||typeof value.viewerCanClose!=='boolean'||typeof value.viewerCanReopen!=='boolean')throw fail('Thread identity or state permission could not be verified.',true);
    return value;
  }
  async function chatThreadState(message) {
    invalidateReadCapabilities();
    await globalThis.KiCadManagedPolicy?.assertWrites();
    if(message?.provider!==undefined&&message.provider!=='github'||message?.host!==undefined&&message.host!=='https://github.com')throw fail('Invalid GitHub chat provider.',true);
    const {repository,ref,file}=KiCadReviewComments.normalizeScope(message||{}),{kind,number}=message.thread||{},state=message.state,expected=message.expectedUpdatedAt;
    if(message.confirmed!==true||!['issue','discussion'].includes(kind)||!NUMBER(number)||!['open','closed'].includes(state)||typeof expected!=='string'||!/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d{1,3})?Z$/.test(expected)||!Number.isFinite(Date.parse(expected)))throw fail('Confirm a valid thread state and fetched revision.',true);
    const lock='github-thread-state:'+JSON.stringify([repository.toLowerCase(),kind,number]);
    if(locks.has(lock))throw fail('A state change is already in progress.',true);
    const work=(async()=>{
      const current=authEpoch,token=await getToken(),policy=await commentPolicyStatus(repository);
      if(!policy.allowed||!LOGIN.test(policy.login||''))throw fail('Repository policy or account verification blocked this state change.',true);
      await assertCurrentToken(token,current);
      const key=lock+JSON.stringify([policy.login.toLowerCase(),expected,state,ref,file]),saved=(await chrome.storage.local.get(key))[key];
      if(saved?.status==='done')return {...saved.result,duplicate:true};
      if(saved)throw fail('Previous state change has an unconfirmed outcome. Refresh and inspect GitHub before retrying.');
      const fresh=await threadStateSnapshot(repository,kind,number,token,current);
      if(fresh.updatedAt!==expected||fresh.closed===(state==='closed'))throw fail('Conversation state or revision changed. Refresh before changing it.',true);
      if(!fresh[state==='closed'?'viewerCanClose':'viewerCanReopen'])throw fail('GitHub does not permit this state change for your account.',true);
      await KiCadReviewComments.reservePublication(chrome.storage.local,JSON.stringify(['github','https://github.com']),Date.now());
      await globalThis.KiCadManagedPolicy?.assertWrites();await assertCurrentToken(token,current);
      await chrome.storage.local.set({[key]:{status:'pending'}});
      try{
        const verb=state==='closed'?'close':'reopen',type=kind==='issue'?'Issue':'Discussion',operation=verb+type,inputType=verb[0].toUpperCase()+verb.slice(1)+type+'Input';
        const input={[kind+'Id']:fresh.id},value=await threadStateGraphql(token,`mutation($input:${inputType}!){${operation}(input:$input){${kind}{id number closed updatedAt}}}`,{input},current),result=value.data?.[operation]?.[kind];
        await assertCurrentToken(token,current);
        if(result?.id!==fresh.id||result.number!==number||result.closed!==(state==='closed')||typeof result.updatedAt!=='string'||!Number.isFinite(Date.parse(result.updatedAt)))throw fail('GitHub did not confirm the state change. Refresh and inspect the conversation before retrying.');
        const response={provider:'github',repository,kind,number,state,updatedAt:result.updatedAt,url:`https://github.com/${repository}/${kind==='issue'?'issues':'discussions'}/${number}`};
        await chrome.storage.local.set({[key]:{status:'done',result:response}});return response;
      }catch(error){if(error.definitive)await chrome.storage.local.remove(key);throw error;}
    })();locks.set(lock,work);try{return await work;}finally{locks.delete(lock);}
  }

  const confirmedChat = new Map();
  async function chatMessageWrite(message) {
    invalidateReadCapabilities();
    await globalThis.KiCadManagedPolicy?.assertWrites();
    if(message?.provider!==undefined&&message.provider!=='github'||message?.host!==undefined&&message.host!=='https://github.com')throw fail('Invalid GitHub chat provider.',true);
    const {repository,ref,file}=KiCadReviewComments.normalizeScope(message||{}),{kind,number}=message.thread||{};
    const action=message.action,mutation=message.clientMutationId;
    if(!['issue','discussion'].includes(kind)||!NUMBER(number)||!['create','reply','edit'].includes(action)||typeof message.body!=='string'||!message.body.trim()||new TextEncoder().encode(message.body).length>60000||typeof mutation!=='string'||!/^[A-Za-z0-9_-]{16,100}$/.test(mutation))throw fail('Invalid chat message request.',true);
    if(action==='edit'&&(typeof message.messageId!=='string'||typeof message.expectedUpdatedAt!=='string')||action==='reply'&&typeof message.replyTo!=='string')throw fail('A verified message and revision are required.',true);
    const note=message.annotation?KiCadReviewComments.validateComment(message.annotation):null;
    if(!note&&message.body.includes('<!-- kicad-review:'))throw fail('Drawing context must use a validated chat annotation.',true);
    if(note&&(action==='edit'||note.id!==mutation||note.text!==message.body||note.anchor.repository!==repository||note.anchor.ref!==ref||note.anchor.file!==file||note.anchor.provider==='gitlab'||note.threadType!==kind))throw fail('Chat annotation does not match its message and drawing.',true);
    const key='github-chat:'+JSON.stringify([repository.toLowerCase(),kind,number,mutation]);
    if(locks.has(key)){try{await locks.get(key);}catch{}return chatMessageWrite(message);}
    const work=(async()=>{
      const current=authEpoch,token=await getToken(),policy=await commentPolicyStatus(repository);
      if(!policy.allowed||!LOGIN.test(policy.login||''))throw fail('Repository policy or account verification blocked this chat message.',true);
      await assertCurrentToken(token,current);
      const saved=confirmedChat.get(key)||(await chrome.storage.local.get(key))[key];
      const fingerprint=JSON.stringify([action,ref,file,message.messageId||null,message.replyTo||null,message.expectedUpdatedAt||null,message.body,note,policy.login.toLowerCase()]);
      const digest=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(fingerprint))),b=>b.toString(16).padStart(2,'0')).join('');
      if(saved){if(saved.digest!==digest)throw fail('This chat request ID already belongs to another message.',true);if(saved.status==='done')return {...saved.result,duplicate:true};throw fail('Previous chat message has an unconfirmed outcome. Inspect GitHub before retrying.');}
      const thread=await readThread({repository,ref,file,kind,number});
      if(thread.locked||thread.isPullRequest)throw fail('This thread cannot accept Issue or Discussion chat messages.',true);
      const target=thread.comments.find(row=>row.id===(action==='edit'?message.messageId:message.replyTo));
      if(action!=='create'&&!target)throw fail('Message does not belong to the fetched thread or is outside its read limit.',true);
      if(action==='edit'&&(target.author?.toLowerCase()!==policy.login.toLowerCase()||target.updatedAt!==message.expectedUpdatedAt||kind==='discussion'&&(!target.viewerCanUpdate||!target.viewerDidAuthor)))throw fail('Message ownership or revision changed. Refresh before editing.',true);
      if(action==='edit'&&(target.bodyTruncated||target.body.includes('kicad-review:')))throw fail('Edit complete drawing annotations on the service to preserve their anchors.',true);
      await KiCadReviewComments.reservePublication(chrome.storage.local,JSON.stringify(['github','https://github.com']),Date.now());
      let body=message.body,replyTo=null;
      if(note){const attachments=note.capture?[await uploadCapture(note,repository,token,current)]:note.attachments;body=KiCadReviewComments.toMarkdown(attachments?{...note,attachments}:note);}
      if(action==='reply'){
        replyTo=target.replyTo||target.id;
        if(kind==='issue')body=`> Reply to [${target.author||'message'}](${target.url})\n\n${body}`;
      }
      await assertCurrentToken(token,current);
      await chrome.storage.local.set({[key]:{status:'pending',digest}});
      try{
        let result;
        if(kind==='issue')result=await request(action==='edit'?`/repos/${repository}/issues/comments/${target.id}`:`/repos/${repository}/issues/${number}/comments`,token,{body},current,action==='edit'?'PATCH':'POST');
        else{
          const parent=action==='reply'?thread.comments.find(row=>row.id===replyTo):null;
          if(!validId(thread.nodeId)||action==='edit'&&!validId(target.nodeId)||action==='reply'&&!validId(parent?.nodeId))throw fail('GitHub did not provide a verified Discussion identifier.',true);
          const operation=action==='edit'?'updateDiscussionComment':'addDiscussionComment',inputType=action==='edit'?'UpdateDiscussionCommentInput':'AddDiscussionCommentInput';
          const input=action==='edit'?{commentId:target.nodeId,body,clientMutationId:mutation}:{discussionId:thread.nodeId,body,clientMutationId:mutation,...(parent?{replyToId:parent.nodeId}:{})};
          const value=await graphql(token,`mutation($input:${inputType}!){${operation}(input:$input){comment{id databaseId updatedAt}}}`,{input},current);
          result=value.data?.[operation]?.comment;
        }
        const id=kind==='issue'?result?.id:result?.databaseId;
        if(!NUMBER(id)||action==='edit'&&String(id)!==target.id)throw fail('GitHub did not confirm the chat message. Inspect the thread before retrying.');
        const updatedAt=kind==='issue'?result.updated_at:result.updatedAt;
        if(typeof updatedAt!=='string'||!/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d{1,3})?Z$/.test(updatedAt)||!Number.isFinite(Date.parse(updatedAt)))throw fail('GitHub did not confirm the message revision. Inspect the thread before retrying.');
        const response={provider:'github',kind,number,messageId:String(id),author:policy.login,createdAt:action==='edit'?target.createdAt:updatedAt,url:thread.url+(kind==='issue'?`#issuecomment-${id}`:`#discussioncomment-${id}`),updatedAt,replyTo};
        invalidateReadCapabilities();
        // Remote acceptance is authoritative even if local receipt storage is full.
        const receipt={status:'done',digest,result:response};
        try{await chrome.storage.local.set({[key]:receipt});}
        catch{response.receiptWarning='Message sent; its local receipt could not be saved. Open the provider conversation to verify it.';confirmedChat.set(key,receipt);if(confirmedChat.size>100)confirmedChat.delete(confirmedChat.keys().next().value);}
        return response;
      }catch(error){if(error.definitive)await chrome.storage.local.remove(key);throw error;}
    })();
    locks.set(key,work);try{return await work;}finally{locks.delete(key);}
  }

  async function chatThreadList(message={}) {
    const {repository,provider}=KiCadReviewComments.normalizeScope(message),{kind,page=1,cursor=null}=message;
    if(provider==='gitlab'||!['issue','discussion'].includes(kind)||!Number.isSafeInteger(page)||page<1||page>5||cursor!==null&&(typeof cursor!=='string'||!cursor||cursor.length>1024||/[\x00-\x1f\x7f]/.test(cursor))||kind==='issue'&&cursor!==null)throw fail('Invalid chat conversation listing.',true);
    const session=await readbackSession(kind==='issue'),[owner,name]=repoParts(repository),warnings=[];
    let rows,hasMore=false,nextCursor=null;
    if(kind==='issue'){
      rows=await readbackJson(`${API}/repos/${repository}/issues?state=all&sort=updated&direction=desc&per_page=20&page=${page}`,session);
      if(!Array.isArray(rows)||rows.length>20)throw fail('GitHub returned an invalid conversation list.',true);
      hasMore=rows.length===20;rows=rows.filter(row=>!row?.pull_request);
    }else{
      const query='query($owner:String!,$name:String!,$cursor:String){repository(owner:$owner,name:$name){discussions(first:20,after:$cursor,orderBy:{field:UPDATED_AT,direction:DESC}){nodes{number title closed updatedAt author{login}} pageInfo{hasNextPage endCursor}}}}';
      const result=await readbackJson(API+'/graphql',session,{query,variables:{owner,name,cursor}}),connection=result.data?.repository?.discussions;
      if(!Array.isArray(connection?.nodes)||connection.nodes.length>20||typeof connection.pageInfo?.hasNextPage!=='boolean')throw fail('GitHub returned an invalid Discussion listing.',true);
      rows=connection.nodes;hasMore=connection.pageInfo.hasNextPage;nextCursor=connection.pageInfo.endCursor;
      if(hasMore&&(typeof nextCursor!=='string'||!nextCursor||nextCursor.length>1024||/[\x00-\x1f\x7f]/.test(nextCursor)||nextCursor===cursor))throw fail('GitHub returned invalid Discussion pagination.',true);
    }
    const threads=[];
    for(const row of rows){
      const author=kind==='issue'?row?.user:row?.author,updatedAt=kind==='issue'?row?.updated_at:row?.updatedAt;
      if(!NUMBER(row?.number)||typeof row.title!=='string'||kind==='issue'&&!['open','closed'].includes(row.state)||kind==='discussion'&&typeof row.closed!=='boolean'||author!==null&&!LOGIN.test(author?.login||'')||typeof updatedAt!=='string'||!/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d{1,3})?Z$/.test(updatedAt)||!Number.isFinite(Date.parse(updatedAt))){if(!warnings.length)warnings.push('Some conversations with invalid provenance were omitted.');continue;}
      threads.push({kind,number:row.number,title:row.title.slice(0,1024),state:kind==='issue'?row.state:row.closed?'closed':'open',author:author?.login||null,updatedAt,url:`https://github.com/${repository}/${kind==='issue'?'issues':'discussions'}/${row.number}`});
    }
    await session.check();return {threads,hasMore:hasMore&&page<5,...(hasMore&&page<5?{nextPage:page+1,...(kind==='discussion'?{cursor:nextCursor}:{})}:{}),warnings,...(hasMore&&page===5?{truncated:true}:{})};
  }

  // Projects are read through the same account session as comments. Only items
  // belonging to the active repository are exposed by the integrated board.
  function boardScope(message) {
    const scope=KiCadReviewComments.normalizeScope(message);
    if(scope.provider==='gitlab')throw fail('Invalid GitHub board provider.',true);
    for(const key of ['boardId','fieldId','itemId'])if(message[key]!==undefined&&!validId(message[key]))throw fail('Invalid GitHub board identifier.',true);
    if(message.cursor!==undefined&&message.cursor!==null&&(typeof message.cursor!=='string'||!message.cursor||message.cursor.length>1024||/[\x00-\x1f\x7f]/.test(message.cursor)))throw fail('Invalid board cursor.',true);
    return scope;
  }
  function boardConnection(value,limit,cursor=null) {
    if(!Array.isArray(value?.nodes)||value.nodes.length>limit||typeof value.pageInfo?.hasNextPage!=='boolean')throw fail('GitHub returned invalid project data.',true);
    const more=value.pageInfo.hasNextPage,next=value.pageInfo.endCursor;
    if(more&&(typeof next!=='string'||!next||next.length>1024||/[\x00-\x1f\x7f]/.test(next)||next===cursor))throw fail('GitHub returned invalid project pagination.',true);
    return {hasMore:more,...(more?{cursor:next}:{}),warnings:[]};
  }
  async function boardList(message={}) {
    const {repository}=boardScope(message),session=await readbackSession(),[owner,name]=repoParts(repository),cursor=message.cursor||null;
    const result=await readbackJson(API+'/graphql',session,{query:'query($owner:String!,$name:String!,$cursor:String){repository(owner:$owner,name:$name){projectsV2(first:20,after:$cursor){nodes{id title number url closed} pageInfo{hasNextPage endCursor}}}}',variables:{owner,name,cursor}});
    const connection=result.data?.repository?.projectsV2,paging=boardConnection(connection,20,cursor),boards=[];
    for(const row of connection.nodes){if(!validId(row?.id)||typeof row.title!=='string'||!NUMBER(row.number))throw fail('GitHub returned invalid project identity.',true);if(!row.closed)boards.push({id:row.id,title:row.title.slice(0,1024),url:boardUrl(row.url)});}
    await session.check();return {boards,...paging};
  }
  function boardUrl(value) {
    let url;try{url=new URL(value);}catch{throw fail('GitHub returned an invalid project URL.',true);}
    if(url.origin!=='https://github.com'||url.username||url.password||!/^\/(?:users|orgs)\/[A-Za-z0-9-]+\/projects\/[1-9][0-9]*$/.test(url.pathname)||url.search||url.hash)throw fail('GitHub returned an invalid project URL.',true);
    return url.href;
  }
  const boardFields='fields(first:100){nodes{... on ProjectV2SingleSelectField{id name options{id name}}} pageInfo{hasNextPage endCursor}}';
  async function boardRead(message={}) {
    const {repository}=boardScope(message);if(!validId(message.boardId))throw fail('Choose a GitHub project.',true);
    const session=await readbackSession(),cursor=message.cursor||null;
    const result=await readbackJson(API+'/graphql',session,{query:`query($id:ID!,$cursor:String){node(id:$id){... on ProjectV2{id title url repositories(first:100){nodes{nameWithOwner} pageInfo{hasNextPage endCursor}} ${boardFields} items(first:50,after:$cursor){nodes{id fieldValues(first:100){nodes{... on ProjectV2ItemFieldSingleSelectValue{optionId field{... on ProjectV2SingleSelectField{id}}}} pageInfo{hasNextPage endCursor}} content{... on Issue{number title repository{nameWithOwner} assignees(first:10){nodes{login}}} ... on PullRequest{number title repository{nameWithOwner} assignees(first:10){nodes{login}}} __typename}} pageInfo{hasNextPage endCursor}}}}}`,variables:{id:message.boardId,cursor}});
    const project=result.data?.node;if(project?.id!==message.boardId||typeof project.title!=='string')throw fail('GitHub project is unavailable. Check Projects permission.',true);
    const repositories=project.repositories;if(!Array.isArray(repositories?.nodes)||!repositories.nodes.some(r=>r?.nameWithOwner?.toLowerCase()===repository.toLowerCase()))throw fail('This project is not linked to the active repository.',true);
    if(!Array.isArray(project.fields?.nodes)||project.fields.nodes.length>100)throw fail('GitHub returned invalid project fields.',true);
    const field=project.fields.nodes.find(f=>message.fieldId?f?.id===message.fieldId:f?.name==='Status');
    if(!field||!validId(field.id)||!Array.isArray(field.options)||field.options.length>100)throw fail('Choose a single-select project status field.',true);
    const columns=[{id:'',title:'No status'},...field.options.map(option=>{if(typeof option?.id!=='string'||!option.id||option.id.length>200||typeof option.name!=='string')throw fail('Invalid project status option.',true);return{id:option.id,title:option.name.slice(0,200)};})];
    const paging=boardConnection(project.items,50,cursor),items=[];
    if(project.fields.pageInfo?.hasNextPage)paging.warnings.push('Project fields are limited to the first 100.');
    for(const row of project.items.nodes){const content=row?.content;if(!content||content.repository?.nameWithOwner?.toLowerCase()!==repository.toLowerCase())continue;
      if(!validId(row.id)||!NUMBER(content.number)||typeof content.title!=='string'||!['Issue','PullRequest'].includes(content.__typename)||!Array.isArray(row.fieldValues?.nodes))throw fail('Invalid GitHub project item.',true);
      const status=row.fieldValues.nodes.find(v=>v?.field?.id===field.id)?.optionId||'';
      if(!columns.some(c=>c.id===status))throw fail('Invalid GitHub project item status.',true);
      if(row.fieldValues.pageInfo?.hasNextPage)paging.warnings.push('Some project item fields were truncated.');
      items.push({id:row.id,title:content.title.slice(0,1024),number:content.number,kind:content.__typename==='Issue'?'issue':'pull',repository,url:`https://github.com/${repository}/${content.__typename==='Issue'?'issues':'pull'}/${content.number}`,columnId:status,assignees:(content.assignees?.nodes||[]).filter(a=>LOGIN.test(a?.login||'')).slice(0,10).map(a=>a.login)});
    }
    await session.check();return{id:project.id,title:project.title.slice(0,1024),url:boardUrl(project.url),fieldId:field.id,columns,items,...paging};
  }
  async function boardMove(message={}) {
    await globalThis.KiCadManagedPolicy?.assertWrites();const {repository}=boardScope(message);
    if(!validId(message.boardId)||!validId(message.itemId)||typeof message.optionId!=='string'||message.optionId.length>200)throw fail('Invalid project move.',true);
    const board=await boardRead({...message,cursor:null});if(!board.columns.some(c=>c.id===message.optionId))throw fail('Project status changed; refresh the board.',true);
    const session=await readbackSession();
    const identity=await readbackJson(API+'/graphql',session,{query:'query($id:ID!){node(id:$id){... on ProjectV2Item{id project{id} fieldValues(first:100){nodes{... on ProjectV2ItemFieldSingleSelectValue{optionId field{... on ProjectV2SingleSelectField{id}}}} pageInfo{hasNextPage endCursor}} content{... on Issue{repository{nameWithOwner}} ... on PullRequest{repository{nameWithOwner}}}}}}',variables:{id:message.itemId}});
    const item=identity.data?.node;if(item?.id!==message.itemId||item.project?.id!==board.id||item.content?.repository?.nameWithOwner?.toLowerCase()!==repository.toLowerCase())throw fail('Project item belongs to another project or repository.',true);
    if(message.expectedColumnId!==undefined){if(!Array.isArray(item.fieldValues?.nodes)||item.fieldValues.pageInfo?.hasNextPage)throw fail('Project item status cannot be verified; refresh before moving.',true);const previous=item.fieldValues.nodes.find(v=>v?.field?.id===board.fieldId)?.optionId||'';if(previous!==message.expectedColumnId)throw fail('Project item status changed. Refresh before moving.',true);}
    const policy=await commentPolicyStatus(repository);if(!policy.allowed)throw fail(policy.reason||'Repository policy does not allow this update.',true);
    await session.check();const clearing=message.optionId==='';
    const query=clearing?'mutation($input:ClearProjectV2ItemFieldValueInput!){clearProjectV2ItemFieldValue(input:$input){projectV2Item{id}}}':'mutation($input:UpdateProjectV2ItemFieldValueInput!){updateProjectV2ItemFieldValue(input:$input){projectV2Item{id}}}';
    const input={projectId:board.id,itemId:message.itemId,fieldId:board.fieldId,...(clearing?{}:{value:{singleSelectOptionId:message.optionId}})};
    const result=await request('/graphql',session.token,{query,variables:{input}},session.epoch,undefined,{stateChange:true});
    const confirmed=result.data?.data?.[clearing?'clearProjectV2ItemFieldValue':'updateProjectV2ItemFieldValue']?.projectV2Item;
    if(confirmed?.id!==message.itemId)throw fail('GitHub did not confirm the project move. Refresh before retrying.');
    return{updated:true,itemId:message.itemId,columnId:message.optionId};
  }

  async function createPullReader(repository, number) {
    repoParts(repository);
    if (!NUMBER(number)) throw fail("Invalid GitHub pull request.", true);
    const session=await readbackSession(true), endpoint=`${API}/repos/${repository}`;
    return { authenticated:Boolean(session.token), read:async(kind, args={})=>{
      let path;
      if(kind==='pull')path=`/pulls/${number}`;
      else if(kind==='files'&&NUMBER(args.page)&&args.page<=30)path=`/pulls/${number}/files?per_page=100&page=${args.page}`;
      else if(kind==='compare'&&/^[0-9a-f]{40}$/i.test(args.base||'')&&/^[0-9a-f]{40}$/i.test(args.head||''))path=`/compare/${args.base}...${args.head}?per_page=1`;
      else throw fail("Invalid GitHub pull comparison request.", true);
      return readbackJson(endpoint+path,session);
    }};
  }
  async function readDiscussionAnnotations({ repository, number, scope } = {}) {
    const [owner, name] = repoParts(repository);
    if (!NUMBER(number)) throw fail("Invalid GitHub Discussion number.", true);
    scope = KiCadReviewComments.normalizeScope(scope);
    if (scope.provider === 'gitlab') throw fail("Invalid GitHub Discussion file scope.", true);
    const session = await readbackSession(), notes = [], warnings = [], seen = new Set();
    const warn = message => { if (!warnings.includes(message)) warnings.push(message); };
    const fields = `id databaseId body createdAt updatedAt author{login}`;
    const connection = `nodes{${fields} replies(first:10){nodes{${fields}} pageInfo{hasNextPage endCursor}}} pageInfo{hasNextPage endCursor}`;
    const query = `query($owner:String!,$name:String!,$number:Int!,$cursor:String){repository(owner:$owner,name:$name){discussion(number:$number){number body createdAt updatedAt closed author{login} comments(first:50,after:$cursor){${connection}}}}}`;
    const replyQuery = `query($id:ID!,$cursor:String){node(id:$id){... on DiscussionComment{replies(first:50,after:$cursor){nodes{${fields}} pageInfo{hasNextPage endCursor}}}}}`;
    let requests = 0, scanned = 0, cursor = null, discussion, stopped = false;
    const replies = [], validCursor = value => typeof value === 'string' && value.length > 0 && value.length <= 512 && !/[\x00-\x1f\x7f]/.test(value);
    const timestamp = value => typeof value === 'string' && /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d{1,3})?Z$/.test(value) && Number.isFinite(Date.parse(value));
    const add = (item, source) => {
      if (scanned >= 500) { stopped = true; return; }
      scanned++;
      if (!item || typeof item.body !== 'string') return;
      let parsed;
      try { parsed = KiCadReviewComments.fromMarkdown(item.body); }
      catch { warn('Some Discussion bodies exceeded the annotation size limit and were omitted.'); return; }
      if (!parsed.length) return;
      if (source !== 'discussion' && !NUMBER(item.databaseId) || !timestamp(item.createdAt) || !timestamp(item.updatedAt) || item.author !== null && !LOGIN.test(item.author?.login || '')) {
        warn('Some Discussion review comments had invalid provenance and were omitted.'); return;
      }
      const url = `https://github.com/${repository}/discussions/${number}` + (source === 'discussion' ? '' : `#discussioncomment-${item.databaseId}`);
      for (const note of parsed) {
        const anchor = note.anchor;
        if (anchor.provider === 'gitlab' || anchor.repository.toLowerCase() !== scope.repository.toLowerCase() || anchor.ref !== scope.ref || anchor.file !== scope.file) continue;
        const key = `${url}:${note.id}`;
        if (seen.has(key)) continue;
        if (notes.length >= 500) { stopped = true; break; }
        seen.add(key);
        notes.push({ ...note, github: { url, number, state: discussion.closed ? 'closed' : 'open', source,
          author: item.author?.login || null, createdAt: item.createdAt, updatedAt: item.updatedAt } });
      }
    };
    const pageCursor = (pageInfo, previous) => {
      if (!pageInfo || typeof pageInfo.hasNextPage !== 'boolean') { warn('Discussion pagination was incomplete; some review comments may be missing.'); return null; }
      if (!pageInfo.hasNextPage) return null;
      if (!validCursor(pageInfo.endCursor) || pageInfo.endCursor === previous) { warn('Discussion pagination was invalid; some review comments may be missing.'); return null; }
      return pageInfo.endCursor;
    };
    do {
      if (requests >= 20 || scanned >= 500 || stopped) break;
      const result = await readbackJson(API + '/graphql', session, { query, variables: { owner, name, number, cursor } }); requests++;
      discussion = result.data?.repository?.discussion;
      if (!discussion || discussion.number !== number || typeof discussion.closed !== 'boolean' || !Array.isArray(discussion.comments?.nodes) || discussion.comments.nodes.length > 50) throw fail("GitHub returned an invalid Discussion response.", true);
      if (cursor === null) add(discussion, 'discussion');
      for (const item of discussion.comments.nodes) {
        if (scanned >= 500 || stopped) { stopped = true; break; }
        add(item, 'discussion-comment');
        if (!Array.isArray(item?.replies?.nodes) || item.replies.nodes.length > 10) { warn('Some Discussion replies were unavailable.'); continue; }
        for (const reply of item.replies.nodes) { add(reply, 'discussion-comment'); if (stopped) break; }
        const next = pageCursor(item.replies.pageInfo, null);
        if (next && validId(item.id)) replies.push({ id: item.id, cursor: next, seen: new Set([next]) });
        else if (next) warn('Some Discussion replies had invalid identifiers and were omitted.');
      }
      cursor = pageCursor(discussion.comments.pageInfo, cursor);
    } while (cursor);
    for (const task of replies) {
      do {
        if (requests >= 20 || scanned >= 500 || stopped) { stopped = true; break; }
        const result = await readbackJson(API + '/graphql', session, { query: replyQuery, variables: { id: task.id, cursor: task.cursor } }); requests++;
        const page = result.data?.node?.replies;
        if (!Array.isArray(page?.nodes) || page.nodes.length > 50) throw fail("GitHub returned an invalid Discussion reply response.", true);
        for (const reply of page.nodes) { add(reply, 'discussion-comment'); if (stopped) break; }
        const next = pageCursor(page.pageInfo, task.cursor);
        if (next && task.seen.has(next)) { warn('Discussion reply pagination repeated; some review comments may be missing.'); break; }
        task.cursor = next; if (next) task.seen.add(next);
      } while (task.cursor);
      if (stopped) break;
    }
    if (cursor || stopped || requests >= 20 && replies.some(task => task.cursor)) warn('Discussion readback was truncated at 500 source records or 20 requests. Some review comments may be missing.');
    await session.check();
    return { notes, warnings };
  }

  const LOGIN = /^[A-Za-z0-9](?:[A-Za-z0-9-]{0,37}[A-Za-z0-9])?$/;
  const POLICY_MODES = new Set(["all", "contributors", "collaborators", "allowlist"]);
  function validatePolicy(value) {
    if (!value || typeof value !== "object" || Array.isArray(value) || value.schemaVersion !== 1 ||
        !value.commenting || typeof value.commenting !== "object" || Array.isArray(value.commenting) ||
        !POLICY_MODES.has(value.commenting.mode) ||
        Object.keys(value).some((key) => !["schemaVersion", "commenting"].includes(key)) ||
        Object.keys(value.commenting).some((key) => !["mode", "allowlist"].includes(key))) {
      throw fail("Repository comment policy is malformed; publishing is blocked.", true);
    }
    const list = value.commenting.allowlist ?? [];
    if (!Array.isArray(list) || list.length > 100 || list.some((login) => typeof login !== "string" || !LOGIN.test(login))) {
      throw fail("Repository comment policy allowlist is invalid; publishing is blocked.", true);
    }
    return { mode: value.commenting.mode, allowlist: [...new Set(list.map((login) => login.toLowerCase()))] };
  }
  function websitePolicyDecision(repository, snapshot, login) {
    repoParts(repository);
    if (!snapshot || !/^[a-f0-9]{40}$/i.test(snapshot.sha || '') || !['default', 'repository'].includes(snapshot.source) ||
        snapshot.source === 'default' && snapshot.content !== undefined || snapshot.source === 'repository' && typeof snapshot.content !== 'string') {
      throw fail('The current default-branch comment policy could not be verified. Nothing posted.', true);
    }
    let policy = { mode: 'all', allowlist: [] };
    if (snapshot.source === 'repository') {
      if (new TextEncoder().encode(snapshot.content).length > 128 * 1024) throw fail('Repository comment policy is too large.', true);
      try { policy = validatePolicy(JSON.parse(snapshot.content)); }
      catch { throw fail('Repository comment policy is malformed; publishing is blocked.', true); }
    }
    const result = { repository, ref: snapshot.sha, mode: policy.mode, source: snapshot.source, transport: 'website-session', allowed: false,
      reason: 'Sign in to GitHub in the matching repository tab before commenting.' };
    if (!LOGIN.test(login || '') || snapshot.account !== login) {
      result.reason = 'The website account changed or could not be verified during the policy check. Nothing posted.';
      return result;
    }
    result.login = login;
    if (policy.mode === 'all') return { ...result, allowed: true, reason: 'Repository policy allows signed-in website users to comment.' };
    if (login.toLowerCase() === repository.split('/')[0].toLowerCase() || policy.allowlist.includes(login.toLowerCase())) {
      return { ...result, allowed: true, reason: 'Repository policy permits this website account.' };
    }
    result.reason = policy.mode === 'allowlist' ? 'This website account is not on the repository comment allowlist.' :
      'The browser session cannot verify the required ' + policy.mode + ' rule. Ask the repository owner to add this account to its explicit review allowlist, or use a separately verified account connection.';
    return result;
  }
  async function policyGet(path, token, maxBytes = 1024 * 1024, accept = "application/vnd.github+json") {
    if (token) await assertCurrentToken(token);
    if (typeof path !== "string" || !(path === "/user" || path.startsWith("/repos/")) ||
        path.includes("//") || path.includes("..")) throw fail("Invalid GitHub policy request.", true);
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 30000);
    let response;
    try {
      response = await fetch(API + path, { headers: { Accept: accept,
        "X-GitHub-Api-Version": "2022-11-28", ...(token ? { Authorization: `Bearer ${token}` } : {}) },
      credentials: "omit", cache: "no-store", redirect: "error", signal: controller.signal });
      if (response.status === 404) return null;
      if (response.status !== 200) throw fail("GitHub could not verify the repository comment policy.", true);
      if (Number(response.headers.get("content-length")) > maxBytes) throw fail("GitHub policy response is too large.", true);
      const text = await response.text();
      if (new TextEncoder().encode(text).length > maxBytes) throw fail("GitHub policy response is too large.", true);
      return { text, contentType: response.headers.get("content-type") || "" };
    } catch (error) {
      if (error.definitive) throw error;
      throw fail("GitHub could not verify the repository comment policy.", true);
    } finally { clearTimeout(timeout); }
  }
  function policyJson(response) {
    try { return JSON.parse(response.text); }
    catch { throw fail("GitHub returned invalid policy verification data.", true); }
  }
  async function readPolicy(repository, token) {
    const metadata = await policyGet(`/repos/${repository}`, token);
    const repo = metadata && policyJson(metadata);
    if (typeof repo?.private !== "boolean" || repo.full_name?.toLowerCase() !== repository.toLowerCase() ||
        typeof repo.default_branch !== "string" || !repo.default_branch || repo.default_branch.length > 200 || /[\x00-\x1f\x7f]/.test(repo.default_branch)) {
      throw fail("Target repository is unavailable or account access could not be verified.", true);
    }
    if (repo.private && !token) throw fail("Connect an account with private repository access to verify its comment policy.", true);
    const ref = repo.default_branch;
    // Public policy is read without the token so a fine-grained Issues token lacking
    // Contents permission cannot make an existing policy look like a missing file.
    const raw = await policyGet(`/repos/${repository}/contents/.kicad-review-policy.json?ref=${encodeURIComponent(ref)}`,
      repo.private ? token : null, 128 * 1024, "application/vnd.github.raw+json");
    if (!raw) {
      if (repo.private) {
        // A private Contents 404 can hide missing Contents permission. Verify an
        // accessible, complete root listing before treating policy as absent.
        const listing = await policyGet(`/repos/${repository}/contents?ref=${encodeURIComponent(ref)}`, token, 4 * 1024 * 1024);
        const entries = listing && policyJson(listing);
        if (!Array.isArray(entries) || entries.length >= 1000 || entries.some(item => !item || typeof item.name !== "string" || typeof item.path !== "string" || item.path !== item.name || item.name.includes("/") || item.name === ".kicad-review-policy.json")) {
          throw fail("Private repository comment policy could not be verified. Grant Contents read access; publication is blocked.", true);
        }
      }
      return { ref, isPrivate: repo.private, source: "default", policy: { mode: "all", allowlist: [] } };
    }
    let value = policyJson(raw);
    if (value?.encoding === "base64" && typeof value.content === "string") {
      if (value.content.length > 48 * 1024) throw fail("Repository comment policy is too large.", true);
      try {
        const binary = atob(value.content.replace(/\s/g, ""));
        value = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(
          Uint8Array.from(binary, (character) => character.charCodeAt(0))));
      } catch { throw fail("Repository comment policy is malformed; publishing is blocked.", true); }
    }
    return { ref, isPrivate: repo.private, source: "repository", policy: validatePolicy(value) };
  }
  async function commentPolicyStatus(repository) {
    repoParts(repository);
    const configured = (await tokenStatus()).configured;
    const token = configured ? await getToken() : null;
    const { ref, source, policy, isPrivate } = await readPolicy(repository, token);
    const result = { repository, ref, mode: policy.mode, source, allowed: false,
      reason: "Connect GitHub to publish comments." };
    if (!configured) return result;
    let login = null;
    try {
      const profile = await policyGet("/user", token, 1024 * 1024);
      const value = profile && policyJson(profile);
      if (LOGIN.test(value?.login || "")) login = value.login;
    } catch (error) {
      if (isPrivate || policy.mode !== "all") {
        result.reason = "Could not verify the signed-in GitHub account.";
        return result;
      }
    }
    if (login) result.login = login;
    if (isPrivate && !login) { result.reason = "Could not verify the signed-in GitHub account."; return result; }
    if (policy.mode === "all") {
      result.allowed = true;
      result.reason = source === "default" ? "No repository comment policy; signed-in users may publish." :
        "Repository policy allows signed-in users to publish.";
      return result;
    }
    if (!login) { result.reason = "Could not verify the signed-in GitHub account."; return result; }
    const normalized = login.toLowerCase();
    if (normalized === repository.split("/")[0].toLowerCase()) {
      result.allowed = true;
      result.reason = "Repository owner may publish.";
      return result;
    }
    if (policy.allowlist.includes(normalized)) {
      result.allowed=true;result.reason="Account is on the repository allowlist.";return result;
    }
    if (policy.mode === "allowlist") {
      result.allowed = policy.allowlist.includes(normalized);
      result.reason = result.allowed ? "Account is on the repository allowlist." :
        "Account is not on the repository allowlist.";
      return result;
    }
    if (policy.mode === "collaborators") {
      try {
        const response = await policyGet(`/repos/${repository}/collaborators/${encodeURIComponent(login)}/permission`, token);
        if (!response) { result.reason = "Account is not a repository collaborator."; return result; }
        const permission = policyJson(response).permission;
        result.allowed = ["read", "write", "admin"].includes(permission);
        result.reason = result.allowed ? "GitHub confirms collaborator access." :
          "GitHub did not confirm collaborator access.";
      } catch { result.reason = "Could not verify collaborator permission with GitHub."; }
      return result;
    }
    try {
      for (let page = 1; page <= 10; page++) {
        const response = await policyGet(`/repos/${repository}/contributors?per_page=100&page=${page}`, token, 2 * 1024 * 1024);
        const users = response && policyJson(response);
        if (!Array.isArray(users) || users.length > 100) throw fail("GitHub contributor list is incomplete.", true);
        if (users.some((user) => typeof user?.login === "string" && user.login.toLowerCase() === normalized)) {
          result.allowed = true;
          result.reason = "GitHub confirms repository contribution.";
          return result;
        }
        if (users.length < 100) {
          result.reason = "Account is not a listed repository contributor.";
          return result;
        }
      }
      result.reason = "Contributor verification exceeds the 1,000-account scan limit.";
    } catch { result.reason = "Could not verify repository contribution with GitHub."; }
    return result;
  }
  function publishArgs(message) {
    const note = KiCadReviewComments.validateComment(message?.comment);
    const destination = message.destination;
    if (!DESTINATIONS.has(destination)) throw fail("Invalid GitHub publication destination.", true);
    const repository = message.repository || note.anchor.repository;
    repoParts(repository);
    const number = message.number;
    if ((destination === "issue" || destination === "discussion") !== (number !== undefined)) {
      throw fail("An existing thread number is required only for an existing thread.", true);
    }
    if (number !== undefined && !NUMBER(number)) throw fail("Invalid GitHub thread number.", true);
    if (destination === "new-discussion" && !validId(message.categoryId)) {
      throw fail("Choose a GitHub discussion category.", true);
    }
    if (message.title !== undefined && (typeof message.title !== "string" || !message.title.trim() || message.title.length > 200)) {
      throw fail("Invalid GitHub thread title.", true);
    }
    if(note.threadType&&note.threadType!==(destination.includes("discussion")?"discussion":"issue"))throw fail("The destination does not match this note's Issue or Discussion type.",true);
    return { note, destination, repository, number, categoryId: message.categoryId,
      title: message.title?.trim() || `[${KiCadReviewComments.severityInfo(note.severity).label}] KiCad review: ${note.anchor.file}` };
  }
  function operationKey(args) {
    // Stable across note text edits: one remote publication per local note and target.
    return `github-publish:${JSON.stringify([args.repository.toLowerCase(), args.destination, args.number || 0,
      args.note.anchor.repository.toLowerCase(), args.note.anchor.ref, args.note.anchor.file, args.note.id])}`;
  }
  const locks = new Map();
  function checkedAttachment(value, repository, capture) {
    if (!value || value.provider !== "github" || value.repository !== repository || value.mime !== "image/png" ||
        value.width !== capture.width || value.height !== capture.height || typeof value.url !== "string" ||
        !/^https:\/\/github\.com\/user-attachments\/assets\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value.url)) {
      throw fail("GitHub did not return a valid screenshot attachment URL.", true);
    }
    return { provider: "github", repository, url: value.url, mime: "image/png", width: value.width, height: value.height };
  }
  function captureBytes(capture) {
    let bytes;
    try { bytes = Uint8Array.from(atob(capture.dataUrl.split(",")[1]), character => character.charCodeAt(0)); }
    catch { throw fail("The screenshot PNG is invalid. Capture the area again.", true); }
    const signature = [137, 80, 78, 71, 13, 10, 26, 10];
    if (bytes.length < 33 || bytes.length > 196608 || signature.some((value, index) => bytes[index] !== value) ||
        bytes[8] !== 0 || bytes[9] !== 0 || bytes[10] !== 0 || bytes[11] !== 13 ||
        String.fromCharCode(...bytes.subarray(12, 16)) !== "IHDR") {
      throw fail("The screenshot PNG is invalid or too large. Capture a smaller area again.", true);
    }
    const header = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    if (header.getUint32(16) !== capture.width || header.getUint32(20) !== capture.height) {
      throw fail("Screenshot dimensions do not match the PNG. Capture the area again.", true);
    }
    return bytes;
  }
  async function attachmentResponseText(response) {
    const limit = 16384;
    if (Number(response.headers.get("content-length")) > limit) throw fail("GitHub attachment response is too large; the review note was not posted.", true);
    if (!response.body?.getReader) throw fail("GitHub attachment response cannot be read safely; the review note was not posted.", true);
    const reader = response.body.getReader(), chunks = [];
    let size = 0;
    try {
      for (;;) {
        const { value, done } = await reader.read();
        if (done) break;
        size += value.byteLength;
        if (size > limit) {
          await reader.cancel().catch(() => {});
          throw fail("GitHub attachment response is too large; the review note was not posted.", true);
        }
        chunks.push(value);
      }
      const bytes = new Uint8Array(size);
      let offset = 0;
      for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
      return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
    } finally { reader.releaseLock(); }
  }
  async function uploadCapture(note, repository, token, epoch) {
    // GitHub's attachment API supports OAuth and personal tokens, not App tokens.
    if (!/^(?:gho_|ghp_|github_pat_)/.test(token)) {
      throw fail("Screenshot uploads require a GitHub OAuth or personal access token. App tokens cannot upload attachments.", true);
    }
    const bytes = captureBytes(note.capture);
    const hash = Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", bytes)), byte => byte.toString(16).padStart(2, "0")).join("");
    const receiptKey = `github-attachment:${JSON.stringify([repository.toLowerCase(), note.id, hash])}`;
    const saved = (await chrome.storage.local.get(receiptKey))[receiptKey];
    if (saved?.attachment) return checkedAttachment(saved.attachment, repository, note.capture);
    const metadata = await policyGet(`/repos/${repository}`, token);
    const repo = metadata && policyJson(metadata);
    if (!NUMBER(repo?.id) || repo.full_name?.toLowerCase() !== repository.toLowerCase() || repo.permissions?.push !== true) {
      throw fail("GitHub screenshot attachments require repository write access. Remove the screenshot to publish a text-only note, or connect an account with write access.", true);
    }
    await assertCurrentToken(token, epoch);
    const query = new URLSearchParams({ name: `kicad-review-${hash.slice(0, 20)}.png`, content_type: "image/png", repository_id: String(repo.id) });
    const controller = new AbortController(), timeout = setTimeout(() => controller.abort(), 30000);
    try {
      const response = await fetch(`https://uploads.github.com/user-attachments/assets?${query}`, {
        method: "POST", headers: { Accept: "application/vnd.github+json", "Content-Type": "application/octet-stream", Authorization: `Bearer ${token}` },
        body: bytes, credentials: "omit", cache: "no-store", redirect: "error", signal: controller.signal
      });
      if (!response.ok) throw fail(`GitHub screenshot upload failed (HTTP ${response.status}). Check repository write access; the review note was not posted.`, true);
      const text = await attachmentResponseText(response);
      let value;
      try { value = JSON.parse(text); } catch { throw fail("GitHub attachment response was unreadable; the review note was not posted.", true); }
      const attachment = checkedAttachment({ provider: "github", repository, url: value.url, mime: "image/png", width: note.capture.width, height: note.capture.height }, repository, note.capture);
      // An upload may complete just as sign-out occurs. Persist only its public
      // reference, then stop before any Issue or Discussion publication.
      await chrome.storage.local.set({ [receiptKey]: { attachment } });
      await assertCurrentToken(token, epoch);
      return attachment;
    } catch (error) {
      if (error.definitive) throw error;
      throw fail("GitHub did not confirm screenshot upload. The review note was not posted; try uploading again.", true);
    } finally { clearTimeout(timeout); bytes.fill(0); }
  }
  async function annotationDigest(note) {
    const { capture, ...value } = KiCadReviewComments.validateComment(note);
    const bytes = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(JSON.stringify(value)));
    return Array.from(new Uint8Array(bytes), byte => byte.toString(16).padStart(2, '0')).join('');
  }
  async function recoverPublication(message, lookup) {
    const args = publishArgs(message), key = operationKey(args);
    if (!NUMBER(message.recoveryNumber) || args.number && args.number !== message.recoveryNumber) throw fail('Choose the original GitHub thread number.', true);
    if (locks.has(key)) throw fail('This publication is still running. Wait for it to finish.', true);
    const work = recoverLocked(args, key, message.recoveryNumber, lookup);
    locks.set(key, work);
    try { return await work; } finally { if (locks.get(key) === work) locks.delete(key); }
  }
  async function recoverLocked(args, key, number, lookup) {
    const saved = (await chrome.storage.local.get(key))[key];
    if (saved?.status === 'done' && saved.remoteRef) return {remoteRef:saved.remoteRef, ...(saved.attachments ? {attachments:saved.attachments}:{}), duplicate:true};
    if (saved?.status !== 'pending' || !LOGIN.test(saved.author || '') || !/^[0-9a-f]{64}$/.test(saved.annotationHash || '')) throw fail('No recoverable publication record exists. Older uncertain posts require manual GitHub inspection.', true);
    const epoch = authEpoch, token = await getToken(), profile = policyJson(await policyGet('/user', token, 1024 * 1024));
    if (!LOGIN.test(profile?.login || '') || profile.login.toLowerCase() !== saved.author.toLowerCase()) throw fail('Sign in as the account that attempted this publication.', true);
    const kind = args.destination.includes('discussion') ? 'discussion' : 'issue';
    const result = await lookup({scope:args.note.anchor, pullRepository:args.repository, [kind === 'discussion' ? 'discussionNumber' : 'issueNumber']:number});
    if (!Array.isArray(result?.notes) || result.notes.length > 500) throw fail('GitHub annotation lookup was invalid.', true);
    const matches = [];
    for (const note of result.notes) {
      const remote = note.github;
      if (note.id !== args.note.id || remote?.number !== number || typeof remote.author !== 'string' || remote.author.toLowerCase() !== saved.author.toLowerCase() ||
          remote.source?.startsWith('discussion') !== (kind === 'discussion') ||
          !({'new-issue':['issue'],issue:['issue-comment','pull-request-comment'],'new-discussion':['discussion'],discussion:['discussion-comment','discussion-reply']}[args.destination]).includes(remote.source)) continue;
      if (await annotationDigest(note) !== saved.annotationHash) continue;
      const suffix = typeof remote.url === 'string' ? remote.url.match(/#(?:issuecomment|discussioncomment)-[0-9]+$/)?.[0] || '' : '';
      const url = `https://github.com/${args.repository}/${kind === 'discussion' ? 'discussions' : 'issues'}/${number}${suffix}`;
      const remoteRef = {kind,repository:args.repository,number,url,publishedAt:remote.createdAt};
      KiCadReviewComments.validateComment({...args.note,remoteRefs:[remoteRef]});
      matches.push({remoteRef,...(note.attachments ? {attachments:note.attachments}:{})});
    }
    if (matches.length !== 1) throw fail(matches.length ? 'Multiple matching posts were found; inspect GitHub manually.' : 'No exact matching post from the publishing account was found. The uncertain publication remains protected from retry.', true);
    await assertCurrentToken(token, epoch);
    const confirmed = matches[0];
    await chrome.storage.local.set({[key]:{status:'done',...confirmed}});
    return {...confirmed,recovered:true};
  }
  async function publish(message) {
    invalidateReadCapabilities();
    await globalThis.KiCadManagedPolicy?.assertWrites();
    const args = publishArgs(message), key = operationKey(args);
    if (locks.has(key)) return locks.get(key);
    const work = publishLocked(args, key);
    locks.set(key, work);
    try { return await work; } finally { if (locks.get(key) === work) locks.delete(key); }
  }
  const confirmedPublications = new Map();
  async function publishLocked(args, key) {
    const publicationEpoch = authEpoch;
    const saved = confirmedPublications.get(key)||(await chrome.storage.local.get(key))[key];
    if (saved?.status === "done" && saved.remoteRef) return { remoteRef: saved.remoteRef, ...(saved.attachments ? { attachments: saved.attachments } : {}), duplicate: true };
    if (saved?.status === "pending") {
      throw fail("A previous publication has an unconfirmed outcome. Inspect GitHub before creating another note; this extension will not retry it automatically.");
    }
    const { note, destination, repository, number } = args;
    const token = await getToken();
    const [owner, name] = repoParts(repository);
    let preflight;
    if (destination === "new-discussion") {
      preflight = await categoryBundle(repository);
      if (!preflight.categories.some((item) => item.id === args.categoryId)) throw fail("Discussion category does not belong to this repository.", true);
    } else if (destination === "discussion") {
      const data = await graphql(token, `query($owner:String!,$name:String!,$number:Int!){repository(owner:$owner,name:$name){discussion(number:$number){id number}}}`, { owner, name, number });
      preflight = data.data?.repository?.discussion;
      if (!validId(preflight?.id) || preflight.number !== number) throw fail("GitHub discussion was not found.", true);
    }
    const policy = await commentPolicyStatus(repository);
    if (!policy.allowed) throw fail(`Repository comment policy blocked publication: ${policy.reason}`, true);
    if (publicationEpoch !== authEpoch) throw fail("GitHub account changed or signed out. Review and publish again.", true);
    await KiCadReviewComments.reservePublication(chrome.storage.local, JSON.stringify(['github','https://github.com']), Date.now());
    const attachments = note.capture ? [await uploadCapture(note, repository, token, publicationEpoch)] : note.attachments;
    const body = KiCadReviewComments.toMarkdown(attachments ? { ...note, attachments } : note);
    await assertCurrentToken(token, publicationEpoch);
    await chrome.storage.local.set({ [key]: { status: "pending", startedAt: new Date().toISOString(), author: policy.login || null, annotationHash: await annotationDigest(attachments ? { ...note, attachments } : note) } });
    let remoteRef;
    try {
      const path = `/repos/${owner}/${name}/issues`;
      if (destination === "new-issue") {
        const result = await request(path, token, { title: args.title, body }, publicationEpoch);
        if (!NUMBER(result.number)) throw fail("GitHub did not confirm the new issue number.");
        remoteRef = { kind: "issue", repository, number: result.number,
          url: `https://github.com/${repository}/issues/${result.number}`,
          publishedAt: new Date().toISOString(), ...(validId(result.node_id) ? { nodeId: result.node_id } : {}) };
      } else if (destination === "issue") {
        const result = await request(`${path}/${number}/comments`, token, { body }, publicationEpoch);
        if (!NUMBER(result.id)) throw fail("GitHub did not confirm the new comment.");
        remoteRef = { kind: "issue", repository, number,
          url: `https://github.com/${repository}/issues/${number}#issuecomment-${result.id}`,
          publishedAt: new Date().toISOString(), ...(validId(result.node_id) ? { nodeId: result.node_id } : {}) };
      } else if (destination === "new-discussion") {
        const data = await graphql(token, `mutation($input:CreateDiscussionInput!){createDiscussion(input:$input){discussion{id number}}}`, {
          input: { repositoryId: preflight.repositoryId, categoryId: args.categoryId, title: args.title, body }
        }, publicationEpoch);
        const result = data.data?.createDiscussion?.discussion;
        if (!NUMBER(result?.number) || !validId(result.id)) throw fail("GitHub did not confirm the new discussion.");
        remoteRef = { kind: "discussion", repository, number: result.number, nodeId: result.id,
          url: `https://github.com/${repository}/discussions/${result.number}`, publishedAt: new Date().toISOString() };
      } else {
        const data = await graphql(token, `mutation($input:AddDiscussionCommentInput!){addDiscussionComment(input:$input){comment{id databaseId}}}`, {
          input: { discussionId: preflight.id, body }
        }, publicationEpoch);
        const result = data.data?.addDiscussionComment?.comment;
        if (!validId(result?.id)) throw fail("GitHub did not confirm the new discussion comment.");
        remoteRef = { kind: "discussion", repository, number, nodeId: result.id,
          url: `https://github.com/${repository}/discussions/${number}${NUMBER(result.databaseId) ? `#discussioncomment-${result.databaseId}` : ""}`,
          publishedAt: new Date().toISOString() };
      }
      invalidateReadCapabilities();
      const receipt={status:'done',remoteRef,...(attachments?{attachments}:{})};
      try{await chrome.storage.local.set({[key]:receipt});}
      catch{confirmedPublications.set(key,receipt);if(confirmedPublications.size>100)confirmedPublications.delete(confirmedPublications.keys().next().value);return {remoteRef,...(attachments?{attachments}:{}),receiptWarning:'Posted to GitHub; the local publication receipt could not be saved.'};}
      return {remoteRef,...(attachments?{attachments}:{})};
    } catch (error) {
      if (error.definitive) await chrome.storage.local.remove(key);
      throw error;
    }
  }
  return { boardList, boardRead, boardMove, forkRevision, tokenStatus, setToken, clearToken, resetAuth, authorizationHeaders, deviceStatus, startDevice, pollDevice, cancelDevice,
    commentPolicyStatus, validatePolicy, websitePolicyDecision, categories, publish, recoverPublication, publishArgs, validRepository, createAnnotationReader, createPullReader, readDiscussionAnnotations, readThread, chatThreadState, chatMessageWrite, chatThreadList };
})();

if (typeof globalThis === "object") globalThis.KiCadGitHubReviewApi = KiCadGitHubReviewApi;
if (typeof module === "object" && module.exports) module.exports = KiCadGitHubReviewApi;
