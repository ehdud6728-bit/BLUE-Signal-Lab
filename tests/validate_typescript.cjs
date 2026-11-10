const fs=require('node:fs');
const path=require('node:path');
const ts=require('typescript');
const root=path.resolve(__dirname,'..');
for(const [file,jsx] of [['worker/src/index.ts',false],['web/src/main.tsx',true]]){
 const source=fs.readFileSync(path.join(root,file),'utf8');
 const o=ts.transpileModule(source,{fileName:file,reportDiagnostics:true,compilerOptions:{
   target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ESNext,
   ...(jsx?{jsx:ts.JsxEmit.ReactJSX}:{}),
 }});
 const errors=(o.diagnostics||[]).filter(x=>x.category===ts.DiagnosticCategory.Error);
 if(errors.length){for(const d of errors)console.error(ts.flattenDiagnosticMessageText(d.messageText,'\n'));process.exitCode=1}
 else console.log('Syntax PASS:',file,'compiled bytes',o.outputText.length);
}
