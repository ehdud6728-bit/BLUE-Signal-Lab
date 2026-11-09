"""Offline interactive chart for one symbol from an OHLCV file."""
import argparse
from pathlib import Path
import numpy as np
import pandas as pd
from engine import read_prices, add_indicators, scan_one
from volume_profile import build_profile

def make_chart(prices, code, output, start=None, end=None):
    from plotly.subplots import make_subplots
    import plotly.graph_objects as go
    code=str(code).zfill(6)
    g=prices.loc[prices.code==code].sort_values('date').reset_index(drop=True)
    if g.empty:raise ValueError('No prices for code '+code)
    g=add_indicators(g)
    if end: g=g.loc[g.date<=pd.Timestamp(end)].copy().reset_index(drop=True)
    if g.empty:raise ValueError('No prices at requested end')
    markers=scan_one(g,start or g.date.min().strftime('%Y-%m-%d'),end or g.date.max().strftime('%Y-%m-%d'))
    dates=g.date
    fig=make_subplots(rows=5,cols=2,shared_xaxes=False,vertical_spacing=.035,horizontal_spacing=.045,column_widths=[.78,.22],row_heights=[.49,.12,.13,.13,.13],specs=[[{},{}],[{'colspan':2},None],[{'colspan':2},None],[{'colspan':2},None],[{'colspan':2},None]],subplot_titles=('일봉 · BLUE / 이평선 / 전고점','일봉 추정 매물대','거래량','RSI14 · SMA9','MACD','Slow Stochastic'))
    fig.add_trace(go.Candlestick(x=dates,open=g.open,high=g.high,low=g.low,close=g.close,name='OHLC'),row=1,col=1)
    for n in (20,40,60,112,224):
        fig.add_trace(go.Scatter(x=dates,y=g[f'MA{n}'],mode='lines',name=f'MA{n}',line=dict(width=1),visible=True if n in (20,40,224) else 'legendonly'),row=1,col=1)
    for n in (20,30,40):
        for k,s in ((2.,26),(1.8,20)):
            key=f'BB{n}_K{str(k).replace(".","p")}_S{s}_UPPER'
            fig.add_trace(go.Scatter(x=dates,y=g[key],mode='lines',name=key,line=dict(width=1,dash='dot'),visible=True if (n==20 and s==26) else 'legendonly'),row=1,col=1)
    for n in (20,40):fig.add_trace(go.Scatter(x=dates,y=g[f'ENV{n}_MID'],name=f'ENV{n}_MID',line=dict(width=1.5,dash='dash'),visible='legendonly'),row=1,col=1)
    for n in (20,60,120,224):fig.add_trace(go.Scatter(x=dates,y=g[f'PRIOR_HIGH{n}'],name=f'PRIOR_HIGH{n}',line=dict(width=1,dash='longdash'),visible='legendonly'),row=1,col=1)
    if markers:
        bydate=g.set_index('date'); xs=[];ys=[];txt=[]
        for m in markers:
            dt=pd.Timestamp(m['date']);xs.append(dt);ys.append(float(bydate.loc[dt,'low'])*.98);txt.append(m['signals'])
        fig.add_trace(go.Scatter(x=xs,y=ys,mode='markers',marker=dict(symbol='triangle-up',size=11,color='#1b6fe5'),text=txt,hovertemplate='%{x|%Y-%m-%d}<br>%{text}<extra></extra>',name='BLUE 후보'),row=1,col=1)
    # Right-side horizontal price-by-volume histogram (daily bars, NOT actual trade-at-price).
    profile=build_profile(g,len(g)-1,lookback=120,bins=48)
    if profile['available']:
        binsize=float(profile['edges'][1]-profile['edges'][0])
        fig.add_trace(go.Bar(x=profile['volumes'],y=profile['centers'],orientation='h',width=binsize*.90,
                             name='추정 매물대 (일봉)',marker=dict(color='rgba(55,111,191,.5)'),
                             hovertemplate='가격 %{y:,.0f}<br>배분 거래량 %{x:,.0f}<extra>일봉 추정</extra>'),row=1,col=2)
        for z in sorted(profile['zones'],key=lambda z:z['volume'],reverse=True)[:5]:
            # draw the key zones on the *price panel* only, as translucent horizontal regions
            fig.add_hrect(y0=z['low'],y1=z['high'],fillcolor='rgba(237,143,59,.14)',
                          line_width=0,row=1,col=1)
            fig.add_hrect(y0=z['low'],y1=z['high'],fillcolor='rgba(237,143,59,.11)',
                          line_width=0,row=1,col=2)
            if z['prior_high_windows']:
                fig.add_hline(y=(z['low']+z['high'])/2,line_color='rgba(204,75,32,.85)',
                              line_dash='dash',line_width=1.5,row=1,col=1)
        fig.add_hline(y=float(g.close.iloc[-1]),line_color='#2563eb',line_dash='dot',row=1,col=2)
        fig.update_yaxes(matches='y',showticklabels=False,row=1,col=2)
        fig.update_xaxes(title_text='추정 거래량',row=1,col=2)
    fig.add_annotation(text='일봉 OHLCV 추정: 몸통 70% + 전체 범위 30% · 실제 체결가별 거래량 아님',
                       x=.99,y=1.035,xref='paper',yref='paper',xanchor='right',showarrow=False,font=dict(size=11,color='gray'))
    fig.add_trace(go.Bar(x=dates,y=g.volume,name='거래량'),row=2,col=1)
    fig.add_trace(go.Scatter(x=dates,y=g.RSI14,name='RSI14'),row=3,col=1)
    fig.add_trace(go.Scatter(x=dates,y=g.RSI_SIGNAL9,name='RSI SMA9'),row=3,col=1)
    fig.add_trace(go.Bar(x=dates,y=g.MACD_HIST,name='MACD Histogram'),row=4,col=1)
    fig.add_trace(go.Scatter(x=dates,y=g.MACD,name='MACD'),row=4,col=1)
    fig.add_trace(go.Scatter(x=dates,y=g.MACD_SIGNAL,name='MACD signal'),row=4,col=1)
    for n,ks,ds in ((14,3,3),(12,5,5),(20,12,12)):
        tag=f'SLOW_{n}_{ks}_{ds}'
        show=(n==14)
        fig.add_trace(go.Scatter(x=dates,y=g[tag+'_K'],name=f'Slow %K ({n},{ks},{ds})',line=dict(width=1.7),visible=True if show else 'legendonly'),row=5,col=1)
        fig.add_trace(go.Scatter(x=dates,y=g[tag+'_D'],name=f'Slow %D ({n},{ks},{ds})',line=dict(width=1.7,dash='dash'),visible=True if show else 'legendonly'),row=5,col=1)
        crosses=g.loc[g[tag+'_GC']]
        fig.add_trace(go.Scatter(x=crosses.date,y=crosses[tag+'_K'],mode='markers',marker=dict(symbol='triangle-up',size=8),name=f'Slow GC ({n},{ks},{ds})',visible=True if show else 'legendonly'),row=5,col=1)
    for level in (20,80):
        fig.add_hline(y=level,line_dash='dot',line_width=1,line_color='gray',row=5,col=1)
    fig.update_layout(title=f'BLUE Signal Lab R0.2 | {code} | RESEARCH ONLY',height=1420,hovermode='x unified',xaxis_rangeslider_visible=False,legend=dict(orientation='h',y=-.13),template='plotly_white')
    fig.update_yaxes(title_text='가격',row=1,col=1);fig.update_yaxes(title_text='Volume',row=2,col=1)
    fig.update_yaxes(title_text='RSI',range=[0,100],row=3,col=1);fig.update_yaxes(title_text='MACD',row=4,col=1);fig.update_yaxes(title_text='Slow',range=[0,100],row=5,col=1)
    out=Path(output);out.parent.mkdir(parents=True,exist_ok=True)
    fig.write_html(str(out),include_plotlyjs=True,full_html=True)
    return out,len(markers)

def main():
    a=argparse.ArgumentParser();a.add_argument('--prices',required=True);a.add_argument('--code',required=True)
    a.add_argument('--out',default='blue_chart.html');a.add_argument('--start');a.add_argument('--end')
    args=a.parse_args()
    out,n=make_chart(read_prices(args.prices),args.code,args.out,args.start,args.end)
    print(f'{out}: {n} BLUE candidates')
if __name__=='__main__':main()
