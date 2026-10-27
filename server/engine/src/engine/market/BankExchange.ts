import { readFileSync } from 'node:fs';
import Environment from '#/util/Environment.js';
import World from '#/engine/World.js';
import Player from '#/engine/entity/Player.js';
import { PlayerLoading } from '#/engine/entity/PlayerLoading.js';
import Packet from '#/io/Packet.js';
import InvType from '#/cache/config/InvType.js';
import ObjType from '#/cache/config/ObjType.js';
import { marketStore, positive, type MarketAccount } from './MarketStore.js';
import { canonicalItem, catalog } from './MarketCatalog.js';

export const bankInstructions='Grand Exchange mode: bank-only escrow. Buy orders reserve quantity × limit GP; sells reserve bank goods. Compatible orders settle automatically at the resting price, price then time priority, without fees or meetings. Partial fills remain open; buyer price improvement is refunded. Bank-full/stack-limit proceeds remain visible as pending delivery and retry automatically. Inspect search(owner=me,status=all), listing(id) and fills. Cancel returns only unfilled escrow; completed fills are final. Use Services (adverts) for services/custom production, Market for owned goods and inputs.';
const integer=(n:any,min=0,max=2147483647)=>{if(!Number.isSafeInteger(n)||n<min||n>max)throw Error('Invalid integer');return n as number;};
const bounded=(value:any,max:number)=>{if(typeof value!=='string'||value.length>max)throw Error('Invalid text');return value;};
const writes=['create','edit','cancel','take'];

/** Only called on the engine thread. No await occurs between bank reads and commit. */
export class BankExchange {
    private store=marketStore();
    private db=this.store.db;
    constructor() {
        this.store.initBankOrders();
        this.db.exec(`CREATE TABLE IF NOT EXISTS bank_market_settings(id INTEGER PRIMARY KEY CHECK(id=1),mode TEXT NOT NULL);
            INSERT OR IGNORE INTO bank_market_settings VALUES(1,'broker');
            CREATE TABLE IF NOT EXISTS bank_order_meta(id INTEGER PRIMARY KEY,note TEXT NOT NULL,expires INTEGER NOT NULL);
            CREATE TABLE IF NOT EXISTS bank_requests(owner TEXT NOT NULL,key TEXT NOT NULL,payload TEXT NOT NULL,result TEXT NOT NULL,PRIMARY KEY(owner,key));`);
    }
    mode():string{return (this.db.query('SELECT mode FROM bank_market_settings WHERE id=1').get() as any).mode;}
    private row(id:any):any {
        const o=this.db.query("SELECT o.*,m.note,m.expires FROM offers o JOIN bank_order_meta m ON m.id=o.id WHERE o.id=? AND channel='bank'").get(integer(id,1));
        if(!o)throw Error('Listing not found');return o;
    }
    private render(o:any,owner:string|null=null) {
        const result:any={id:o.id,owner:o.owner,ownerName:o.owner,side:o.side,item_id:o.item,item_name:ObjType.get(o.item).name,quantity:o.quantity,filled:o.filled,price:o.price,note:o.note,revision:o.revision,
            status:o.state==='open'?(o.filled?'partial':'open'):o.state==='completed'?'filled':'cancelled',created_at:o.created,updated_at:o.created,expires_at:o.expires,remaining:o.remaining,available:o.state==='open'?o.remaining:0,pending:0};
        if(owner===null||owner===o.owner){result.reservedItems=o.state==='open'&&o.side==='sell'?o.remaining:0;result.reservedGP=o.state==='open'&&o.side==='buy'?o.remaining*o.price:0;result.deliveryPending={items:o.items,gp:o.coins};}
        return result;
    }
    private player(owner:string):Player {
        if(!/^[a-z0-9_ ]{1,12}$/.test(owner))throw Error('Invalid account');
        if(World.logoutRequests.has(owner)||World.loginRequests.size||World.newPlayers.size)throw Error('Account transition in progress; retry shortly with the same key');
        const online=World.getPlayerByUsername(owner);
        if(online)return online;
        let save=this.store.saved(owner);
        if(!save){try{save=readFileSync(`data/players/${Environment.node.profile}/${owner}.sav`);}catch{throw Error('No existing character save; bank items first');}}
        return PlayerLoading.load(owner,new Packet(save),null);
    }
    private account(p:Player):MarketAccount {
        const bank=p.getInventory(InvType.getId('bank'))!;
        const before=bank.items.map(i=>i?{...i}:null);
        return {owner:p.username,take(id,n){if(bank.getItemCount(id)<n)throw Error('Insufficient bank items or GP; bank assets first');if(bank.remove(id,n)!==n)throw Error('Bank changed');},give:(id,n)=>bank.add(id,n),
            save:()=>{const bytes=p.save(false);World.checkpointPlayers(p,bytes);return bytes;},rollback:()=>before.forEach((item,i)=>bank.set(i,item))};
    }
    /** All touched live banks roll back together if any nested ledger operation fails. */
    private atomic<T>(action:(get:(owner:string)=>MarketAccount)=>T):T {
        const accounts=new Map<string,MarketAccount>();
        const get=(owner:string)=>{let a=accounts.get(owner);if(!a){a=this.account(this.player(owner));accounts.set(owner,a);}return a;};
        try{let result!:T;this.db.transaction(()=>{result=action(get);}).immediate();return result;}
        catch(error){for(const a of accounts.values())a.rollback();throw error;}
    }
    private deliver(get:(owner:string)=>MarketAccount) {
        const owners=this.db.query("SELECT DISTINCT owner FROM offers WHERE channel='bank' AND slot>=0 AND (items>0 OR coins>0 OR state<>'open')").all() as {owner:string}[];
        for(const {owner} of owners) {
            // Login/logout transitions block this owner's delivery, never matching or
            // another owner's settlement. Unavailable assets remain in durable escrow.
            let account:MarketAccount;try{account=get(owner);}catch{continue;}
            const ids=this.db.query("SELECT id FROM offers WHERE owner=? AND channel='bank' AND slot>=0").all(owner) as {id:number}[];
            this.store.collectMany(account,ids,ObjType.getId('coins'));
        }
    }
    sync() {
        this.atomic(get=>{
            for(const o of this.db.query("SELECT o.id,o.owner FROM offers o JOIN bank_order_meta m ON m.id=o.id WHERE channel='bank' AND state='open' AND m.expires<=?").all(Date.now()) as any[])this.store.cancel(o.owner,o.id);
            this.deliver(get);
        });
    }
    call(owner:string|null,op:string,a:any={}):any {
        if(!a||typeof a!=='object'||Array.isArray(a))throw Error('Invalid arguments');
        const allowed:Record<string,string[]>={settings:[],configure:['mode'],sync:[],context:[],items:['query','after','limit'],search:['item','query','side','owner','status','after','limit'],listing:['id'],price:['item'],fills:['item','after','limit'],deals:['after','limit','status'],create:['key','side','item','quantity','price','note','expiresAt'],take:['key','id','expectedRevision','quantity'],cancel:['key','id','expectedRevision'],edit:['key','id','expectedRevision','quantity','price','note','expiresAt']};
        if(!allowed[op]||Object.keys(a).some(k=>!allowed[op]!.includes(k)))throw Error('Unknown operation or argument');
        if(op==='configure'){
            if(owner!==null||!['broker','exchange'].includes(a.mode))throw Error('Operator mode change required');
            if(a.mode==='broker'&&this.db.query("SELECT 1 FROM offers WHERE channel='bank' AND (state='open' OR items>0 OR coins>0) LIMIT 1").get())throw Error('Cancel orders and deliver outstanding escrow before switching modes');
            this.db.query('UPDATE bank_market_settings SET mode=? WHERE id=1').run(a.mode);return {mode:this.mode(),instructions:bankInstructions};
        }
        if(op==='settings')return {mode:this.mode(),instructions:bankInstructions};
        if(op==='sync'){this.sync();return {mode:this.mode()};}
        this.sync();
        if(this.mode()!=='exchange')throw Error('Grand Exchange mode is disabled');
        if(writes.includes(op)&&!owner)throw Error('Operator market access is read-only');
        return this.atomic(get=>{
            const payload=JSON.stringify({op,a});
            if(writes.includes(op)){
                bounded(a.key,100);if(!a.key.trim())throw Error('Retry key required');
                const old=this.db.query('SELECT payload,result FROM bank_requests WHERE owner=? AND key=?').get(owner!,a.key) as any;
                if(old){if(old.payload!==payload)throw Error('Retry key already used for different content');return JSON.parse(old.result);}
            }
            let result:any;
            const now=Date.now(),limit=integer(a.limit??20,1,50),after=integer(a.after??0);
            if(op==='context'){
                if(!owner)throw Error('Character required');
                const own=this.db.query("SELECT o.*,m.note,m.expires FROM offers o JOIN bank_order_meta m ON m.id=o.id WHERE channel='bank' AND owner=? ORDER BY (state='open' OR items>0 OR coins>0) DESC,o.id DESC LIMIT 30").all(owner) as any[];
                result={ownListings:own.map(o=>this.render(o,owner)),recentOwnFills:this.trades(null,0,0,10,owner),ownDeals:[],updates:[],cursor:0,review:bankInstructions,opportunities:this.search(owner,{limit:6}).listings,recentListings:this.search(owner,{limit:6}).listings};
            }else if(op==='items')result={items:catalog(bounded(a.query??'',100)).slice(after,after+Math.min(limit,20)).map(o=>({...o,tradeable:true})),next:after+Math.min(limit,20)};
            else if(op==='search')result=this.search(owner,a);
            else if(op==='listing')result={listing:this.render(this.row(a.id),owner),revisions:[]};
            else if(op==='deals')result={deals:[],next:null,note:'Grand Exchange orders settle automatically; inspect own listings and fills. Broker history remains in the panel database.'};
            else if(op==='price'){
                const item=canonicalItem(integer(a.item));
                const windows=[24,168].map(hours=>{
                    const rows=this.db.query(`SELECT CASE WHEN t.buy_offer>t.sell_offer THEN 'buy' ELSE 'sell' END initiator,SUM(t.quantity) units,SUM(t.gross) gp,COUNT(*) fills,MAX(t.time) latest FROM trades t JOIN offers o ON o.id=t.buy_offer WHERE o.channel='bank' AND t.item=? AND t.time>=? GROUP BY 1`).all(item,now-hours*3600000) as any[];
                    const stats=(side?:string)=>{const r=side?rows.filter(r=>r.initiator===side):rows;const units=r.reduce((n,r)=>n+r.units,0);return {averageGP:units?r.reduce((n,r)=>n+r.gp,0)/units:null,units,fills:r.reduce((n,r)=>n+r.fills,0),latest:r.length?Math.max(...r.map(r=>r.latest)):null};};return {hours,buyNow:stats('buy'),sellNow:stats('sell'),overall:stats()};});
                const book=this.db.query("SELECT MAX(CASE WHEN side='buy' THEN price END) bid, MIN(CASE WHEN side='sell' THEN price END) ask FROM offers WHERE channel='bank' AND state='open' AND item=?").get(item) as any;
                result={item:{id:item,name:ObjType.get(item).name},windows,bestBid:book.bid,bestAsk:book.ask,priceDiscovery:{message:'Offers are not completed sales. Base value and NPC quotes are separate references; choose useful, affordable prices.'}};
            }else if(op==='fills'){
                const rows=this.trades(a.item===undefined?null:canonicalItem(integer(a.item)),0,after,limit+1);result={fills:rows.slice(0,limit),next:rows.length>limit?after+limit:null};
            }else if(op==='create'||op==='take'){
                let side=a.side,item=a.item,q=a.quantity,price=a.price;
                if(op==='take'){const l=this.row(a.id);if(l.owner===owner)throw Error('Cannot trade with yourself');if(l.revision!==integer(a.expectedRevision))throw Error('Listing revision changed');q=positive(a.quantity,'Quantity');if(l.state!=='open'||q>l.remaining)throw Error('Insufficient listing quantity');side=l.side==='buy'?'sell':'buy';item=l.item;price=l.price;}
                if(!['buy','sell'].includes(side))throw Error('Invalid side');item=canonicalItem(integer(item));q=positive(q,'Quantity');price=positive(price,'Price');
                const expiry=a.expiresAt===undefined?now+7*86400000:integer(a.expiresAt,now+60000,now+30*86400000);
                const o=this.store.place(get(owner!),item,side,q,price,ObjType.getId('coins'),undefined,'bank');
                this.db.query('INSERT INTO bank_order_meta VALUES(?,?,?)').run(o.id,bounded(a.note??'',500),expiry);
                this.deliver(get);result={listing:this.render(this.row(o.id),owner),note:'Escrow reserved; matching and bank delivery are automatic. Take uses the selected price limit against the best available orders, not a private counterparty guarantee.'};
            }else if(op==='cancel'||op==='edit'){
                const old=this.row(a.id);if(old.owner!==owner)throw Error('Only the owner can change a listing');if(old.revision!==integer(a.expectedRevision))throw Error('Listing revision changed');if(old.state!=='open')throw Error('Listing is no longer open');
                this.store.cancel(owner!,old.id);
                if(op==='cancel'){this.deliver(get);result={listing:this.render(this.row(old.id),owner)};}
                else {
                    // Cancel/replace in one transaction: if the replacement cannot be
                    // funded or the refund cannot fit, restore the whole original order.
                    const account=get(owner!);this.store.collect(account,old.id,ObjType.getId('coins'));
                    const refunded=this.row(old.id);if(refunded.items||refunded.coins)throw Error('Bank cannot receive old escrow; edit left unchanged');
                    const quantity=a.quantity===undefined?old.quantity:positive(a.quantity,'Quantity');if(quantity<=old.filled)throw Error('New total must exceed units already filled');
                    const price=a.price===undefined?old.price:positive(a.price,'Price');
                    const expiry=a.expiresAt===undefined?old.expires:integer(a.expiresAt,now+60000,now+30*86400000);
                    const replacement=this.store.place(account,old.item,old.side,quantity-old.filled,price,ObjType.getId('coins'),undefined,'bank');
                    this.db.query('INSERT INTO bank_order_meta VALUES(?,?,?)').run(replacement.id,a.note===undefined?old.note:bounded(a.note,500),expiry);
                    this.deliver(get);result={listing:this.render(this.row(replacement.id),owner),replacedListing:old.id,note:'Edit atomically cancels/replaces the unfilled portion with a new ID and time priority; old fills remain final.'};
                }
            }else throw Error('Unknown operation');
            const output={mode:'exchange',instructions:bankInstructions,...result};
            if(writes.includes(op))this.db.query('INSERT INTO bank_requests VALUES(?,?,?,?)').run(owner!,a.key,payload,JSON.stringify(output));
            return output;
        });
    }
    private search(owner:string|null,a:any):any {
        const clauses=["o.channel='bank'"],params:any[]=[];
        if(a.status===undefined||a.status==='active')clauses.push("o.state='open'");else if(a.status!=='all')throw Error('Invalid status');
        if(a.item!==undefined){clauses.push('o.item=?');params.push(canonicalItem(integer(a.item)));}
        if(a.side!==undefined){if(!['buy','sell'].includes(a.side))throw Error('Invalid side');clauses.push('o.side=?');params.push(a.side);}
        if(a.owner){if(a.owner==='me'&&!owner)throw Error('Character required');clauses.push('o.owner=?');params.push(a.owner==='me'?owner:bounded(a.owner,12).toLowerCase());}
        let rows=this.db.query(`SELECT o.*,m.note,m.expires FROM offers o JOIN bank_order_meta m ON m.id=o.id WHERE ${clauses.join(' AND ')} ORDER BY o.side,CASE WHEN o.side='buy' THEN -o.price ELSE o.price END,o.id`).all(...params) as any[];
        if(a.query){const q=bounded(a.query,100).toLowerCase();rows=rows.filter(o=>(ObjType.get(o.item).name??'').toLowerCase().includes(q));}
        const after=integer(a.after??0),limit=integer(a.limit??20,1,50);
        return {listings:rows.slice(after,after+limit).map(o=>this.render(o,owner)),next:rows.length>after+limit?after+limit:null};
    }
    private trades(item:number|null,since:number,after=0,limit=50,owner:string|null=null):any[] {
        const conditions=["b.channel='bank'",'t.time>=?'],params:any[]=[since];
        if(item!==null){conditions.push('t.item=?');params.push(item);}
        if(owner){conditions.push('(b.owner=? OR s.owner=?)');params.push(owner,owner);}
        return (this.db.query(`SELECT t.id,t.item AS item_id,t.quantity,t.gross AS gp,t.time AS at,t.buy_offer,t.sell_offer,b.owner buyer,s.owner seller,CASE WHEN t.buy_offer>t.sell_offer THEN 'buy' ELSE 'sell' END AS initiator FROM trades t JOIN offers b ON b.id=t.buy_offer JOIN offers s ON s.id=t.sell_offer WHERE ${conditions.join(' AND ')} ORDER BY t.id DESC LIMIT ? OFFSET ?`).all(...params,limit,after) as any[]).map(t=>({...t,item_name:ObjType.get(t.item_id).name,deal:t.id,settlement:t.id}));
    }
}
