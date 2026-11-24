type Item={code:string;name:string;price:number;signals:string[];observed_at_utc:string;
  extras?:Record<string,unknown>;turnover_available:boolean;traded_amount_krw:number|null;provisional:true;pattern_confirmed:false};
export type ProvisionalSnapshot={storage:string;day:string;data_status:string;pattern_confirmed:false;complete_market:false;
  page:number;limit:number;total:number;ai_count:number|null;ai_only:boolean;ai_asof:string;ai_evidence_count:number;unfiltered_total:number;matched_count:number;observed_count:number;eligible_count:number;
  turnover_available_count:number;reference_day:string|null;scan_asof_utc:string|null;latest_observed_utc:string|null;items:Item[]};
