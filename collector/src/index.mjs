import {WorkerEntrypoint} from 'cloudflare:workers';
import handler from './handler.mjs';
import {collectSymbolLiveInstant} from './instant-quote.mjs';
import {collectTursoInstant} from './turso-direct.mjs';

// Named RPC entrypoint: unreachable through the collector's public fetch URL.
// Only a Cloudflare Worker configured with a service binding can invoke it.
export class InstantQuoteService extends WorkerEntrypoint {
  async collectNow(code){
    return collectSymbolLiveInstant(this.env,code);
  }
  async collectNowTurso(code){
    return collectTursoInstant(this.env,code);
  }
}

export default handler;
