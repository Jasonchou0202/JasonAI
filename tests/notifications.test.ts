import { afterEach, expect, it, vi } from 'vitest';
import { stopPush } from '../src/lib/notifications';
afterEach(()=>vi.unstubAllGlobals());
it('云端撤销失败仍撤销本机订阅，并保留设备 ID 以供重试', async()=>{
  const unsubscribe=vi.fn().mockResolvedValue(true), removeItem=vi.fn();
  vi.stubGlobal('localStorage',{getItem:()=> 'device-1',removeItem});
  vi.stubGlobal('navigator',{serviceWorker:{getRegistration:async()=>({pushManager:{getSubscription:async()=>({unsubscribe})}})}});
  await expect(stopPush({call:async()=>{throw new Error('offline');}})).rejects.toThrow('offline');
  expect(unsubscribe).toHaveBeenCalledOnce();
  expect(removeItem).not.toHaveBeenCalled();
});
it('云端和本机撤销确认后移除设备 ID', async()=>{
  const removeItem=vi.fn(), call=vi.fn().mockResolvedValue({active:false});
  vi.stubGlobal('localStorage',{getItem:()=> 'device-1',removeItem});
  vi.stubGlobal('navigator',{});
  await stopPush({call});
  expect(call).toHaveBeenCalledWith('push.unsubscribe',{id:'device-1'});
  expect(removeItem).toHaveBeenCalledWith('zhangyuge-push-device');
});
