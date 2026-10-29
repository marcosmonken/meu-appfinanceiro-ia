import React, { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, Alert, FlatList, KeyboardAvoidingView, Modal, Platform, Pressable, SafeAreaView, ScrollView, StatusBar, StyleSheet, Text, TextInput, View } from 'react-native';
import { SQLiteProvider, useSQLiteContext } from 'expo-sqlite';
import * as FileSystem from 'expo-file-system/legacy';
import * as Sharing from 'expo-sharing';
import * as DocumentPicker from 'expo-document-picker';

const BG = '#0A141D', PANEL = '#091B29', BLUE = '#0AC8B9', MUTED = '#9BA7AD', WHITE = '#F0E6D2';
const GOLD = '#C8A037', RED = '#E84057', GREEN = '#00D26A';
const categories = ['Alimentação', 'Mercado', 'Transporte', 'Moradia', 'Saúde', 'Lazer', 'Compras', 'Salário', 'Freelance', 'Outros'];
const brl = n => Number(n || 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
const dateText = iso => { const [y,m,d] = iso.split('-'); return `${d}/${m}/${y}`; };
const today = () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`; };
const moneyToCents = s => { const cleaned = String(s).trim().replace(/\s/g,'').replace(/\./g,'').replace(',','.'); const n = Number(cleaned); return Number.isFinite(n) && n > 0 ? Math.round(n * 100) : null; };

async function migrate(db) {
  await db.execAsync(`PRAGMA journal_mode = WAL;
    CREATE TABLE IF NOT EXISTS transactions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      type TEXT NOT NULL CHECK(type IN ('receita','despesa')),
      amount_cents INTEGER NOT NULL CHECK(amount_cents > 0),
      category TEXT NOT NULL,
      description TEXT NOT NULL,
      date TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );`);
}
function Button({ label, onPress, secondary = false, danger = false }) {
  return <Pressable onPress={onPress} style={[styles.button, secondary && styles.buttonSecondary, danger && styles.buttonDanger]}><Text style={styles.buttonText}>{label}</Text></Pressable>;
}
function AppContent() {
  const db = useSQLiteContext();
  const [items, setItems] = useState([]);
  const [screen, setScreen] = useState('Início');
  const [modal, setModal] = useState(false);
  const [type, setType] = useState('despesa');
  const [amount, setAmount] = useState('');
  const [description, setDescription] = useState('');
  const [category, setCategory] = useState('Alimentação');
  const [date, setDate] = useState(today());
  const [saving, setSaving] = useState(false);
  const [filter, setFilter] = useState('todas');
  const [backupBusy, setBackupBusy] = useState(false);
  const exportBackup = async () => {
    if (backupBusy) return;
    setBackupBusy(true);
    try {
      const records = await db.getAllAsync('SELECT id,type,amount_cents,category,description,date,created_at FROM transactions ORDER BY id');
      const payload = { format: 'mybank-transactions', version: 1, exported_at: new Date().toISOString(), transactions: records };
      const path = `${FileSystem.cacheDirectory}mybank-backup-${new Date().toISOString().replace(/[:.]/g, '-')}.json`;
      await FileSystem.writeAsStringAsync(path, JSON.stringify(payload, null, 2), { encoding: FileSystem.EncodingType.UTF8 });
      if (!(await Sharing.isAvailableAsync())) throw new Error('Compartilhamento de arquivos indisponível neste aparelho.');
      await Sharing.shareAsync(path, { mimeType: 'application/json', dialogTitle: 'Salvar backup do MY BANK', UTI: 'public.json' });
      Alert.alert('Backup preparado', 'Salve o arquivo em um local privado fora do celular. O arquivo contém seus dados financeiros sem criptografia.');
    } catch (e) { Alert.alert('Erro ao exportar backup', String(e.message)); }
    finally { setBackupBusy(false); }
  };
  const restoreBackup = async () => {
    if (backupBusy) return;
    setBackupBusy(true);
    try {
      const result = await DocumentPicker.getDocumentAsync({ type: 'application/json', copyToCacheDirectory: true });
      if (result.canceled) return;
      const asset = result.assets?.[0];
      if (!asset?.uri) throw new Error('Nenhum arquivo selecionado.');
      if (asset.size && asset.size > 10 * 1024 * 1024) throw new Error('Arquivo maior que o limite de 10 MB.');
      const raw = await FileSystem.readAsStringAsync(asset.uri, { encoding: FileSystem.EncodingType.UTF8 });
      if (raw.length > 10 * 1024 * 1024) throw new Error('Arquivo muito grande.');
      const data = JSON.parse(raw);
      if (data?.format !== 'mybank-transactions' || data.version !== 1 || !Array.isArray(data.transactions)) throw new Error('Formato de backup inválido ou incompatível.');
      if (data.transactions.length > 100000) throw new Error('Backup com registros demais.');
      const ids = new Set();
      for (const r of data.transactions) {
        if (!r || !Number.isSafeInteger(r.id) || r.id <= 0 || ids.has(r.id) ||
            !['receita','despesa'].includes(r.type) || !Number.isSafeInteger(r.amount_cents) || r.amount_cents <= 0 ||
            typeof r.category !== 'string' || !r.category.trim() || r.category.length > 200 ||
            typeof r.description !== 'string' || !r.description.trim() || r.description.length > 2000 ||
            typeof r.date !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(r.date) ||
            Number.isNaN(Date.parse(`${r.date}T12:00:00`)) || new Date(`${r.date}T12:00:00`).toISOString().slice(0, 10) !== r.date ||
            typeof r.created_at !== 'string' || r.created_at.length > 100) throw new Error('O backup contém registros inválidos. Nenhum dado foi alterado.');
        ids.add(r.id);
      }
      Alert.alert('Restaurar backup?', `O arquivo contém ${data.transactions.length} lançamento(s). Isso SUBSTITUIRÁ todos os lançamentos atuais. Exporte um backup dos dados atuais antes de continuar.`, [
        { text: 'Cancelar', style: 'cancel' },
        { text: 'Substituir dados', style: 'destructive', onPress: async () => {
          setBackupBusy(true);
          try {
            await db.withExclusiveTransactionAsync(async tx => {
              await tx.runAsync('DELETE FROM transactions');
              for (const r of data.transactions) {
                await tx.runAsync('INSERT INTO transactions (id,type,amount_cents,category,description,date,created_at) VALUES (?,?,?,?,?,?,?)', r.id, r.type, r.amount_cents, r.category, r.description, r.date, r.created_at);
              }
            });
            await refresh();
            Alert.alert('Restauração concluída', `${data.transactions.length} lançamento(s) recuperado(s).`);
          } catch (e) { Alert.alert('Erro ao restaurar', `Os dados anteriores foram preservados se a transação falhou. Detalhes: ${String(e.message)}`); }
          finally { setBackupBusy(false); }
        } }
      ]);
    } catch (e) { Alert.alert('Backup não restaurado', String(e.message)); }
    finally { setBackupBusy(false); }
  };
  const refresh = useCallback(async () => {
    try { setItems(await db.getAllAsync('SELECT * FROM transactions ORDER BY date DESC, id DESC')); }
    catch(e) { Alert.alert('Erro ao carregar', String(e.message)); }
  }, [db]);
  useEffect(() => { refresh(); }, [refresh]);
  const month = today().slice(0, 7);
  const monthly = items.filter(i => i.date.startsWith(month));
  const total = (list, t) => list.filter(i => i.type === t).reduce((sum, i) => sum + i.amount_cents, 0) / 100;
  const income = total(monthly, 'receita'), expense = total(monthly, 'despesa');
  const balance = total(items, 'receita') - total(items, 'despesa');
  const resetForm = () => { setAmount(''); setDescription(''); setDate(today()); setCategory('Alimentação'); setType('despesa'); };
  const save = async () => {
    const cents = moneyToCents(amount);
    if (!cents) return Alert.alert('Valor inválido', 'Informe um valor positivo, como 35,90.');
    if (!description.trim()) return Alert.alert('Descrição obrigatória', 'Descreva a movimentação.');
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || Number.isNaN(Date.parse(`${date}T12:00:00`)) || new Date(`${date}T12:00:00`).toISOString().slice(0,10) !== date) return Alert.alert('Data inválida', 'Use o formato AAAA-MM-DD.');
    setSaving(true);
    try {
      await db.runAsync('INSERT INTO transactions (type,amount_cents,category,description,date) VALUES (?,?,?,?,?)', type, cents, category, description.trim(), date);
      await refresh(); setModal(false); resetForm();
    } catch (e) { Alert.alert('Erro ao salvar', String(e.message)); }
    finally { setSaving(false); }
  };
  const remove = id => Alert.alert('Excluir lançamento?', 'Esta ação não pode ser desfeita.', [
    { text: 'Cancelar', style: 'cancel' },
    { text: 'Excluir', style: 'destructive', onPress: async () => { try { await db.runAsync('DELETE FROM transactions WHERE id = ?', id); await refresh(); } catch(e) { Alert.alert('Erro', String(e.message)); } } }
  ]);
  const [masked, setMasked] = useState(false);
  const [scope, setScope] = useState('todos');
  const display = n => masked ? '••••••' : brl(n);
  const row = item => <Pressable key={item.id} style={styles.row} onLongPress={() => remove(item.id)}>
    <View style={styles.rowIcon}><Text style={styles.rowGlyph}>{item.type === 'receita' ? '✦' : '◆'}</Text></View>
    <View style={{flex:1}}><Text style={styles.rowTitle}>{item.description}</Text><Text style={styles.sub}>{item.category}  ·  {dateText(item.date)}</Text></View>
    <Text style={[styles.rowValue,{color:item.type==='receita'?GREEN:RED}]}>{item.type==='receita'?'+':'−'} {display(item.amount_cents/100)}</Text>
  </Pressable>;
  const Panel = ({children,style}) => <View style={[styles.panel,style]}>{children}</View>;
  const Caption = ({children}) => <Text style={styles.caption}>{children}</Text>;
  const tabs = [['Início','⌂'],['Quests','☷'],['Skills','✦'],['Builds','⬡'],['Bosses','⚑']];
  const recent = items.slice(0,6);
  const count = items.length;
  return <SafeAreaView style={styles.root}>
    <StatusBar barStyle="light-content" backgroundColor={BG}/>
    <View style={styles.header}><View style={styles.logo}><Text style={styles.logoText}>M</Text></View><View style={{flex:1}}><Text style={styles.brand}>MY BANK</Text><Text style={styles.tag}>HEXTECH RPG EDITION</Text></View><Pressable onPress={()=>setMasked(!masked)} style={styles.eye}><Text style={{color:GOLD,fontSize:19}}>{masked?'◉':'◎'}</Text></Pressable></View>
    <ScrollView style={{flex:1}} contentContainerStyle={styles.content}>
    {screen==='Início' && <>
      <Panel style={styles.hero}><View style={styles.heroTop}><View><Text style={styles.heroTitle}>SUMMONER STATUS</Text><Text style={styles.heroName}>AVENTUREIRO <Text style={{color:GOLD}}>· LVL 1</Text></Text></View><Text style={{color:BLUE,fontSize:24}}>✧</Text></View>
        <Text style={styles.xp}>EXPERIÊNCIA (XP)  ·  {count} LANÇAMENTOS</Text><View style={styles.track}><View style={[styles.trackFill,{width:`${Math.min(count*10,100)}%`}]}/></View>
        <View style={styles.metrics}><View style={styles.metric}><Text style={styles.metricLabel}>♥  DESPESAS (HP)</Text><Text style={[styles.metricValue,{color:RED}]}>{display(expense)}</Text></View><View style={styles.metric}><Text style={styles.metricLabel}>✧  RECEITAS (MP)</Text><Text style={[styles.metricValue,{color:BLUE}]}>{display(income)}</Text></View></View>
        <View style={styles.goldBanner}><Text style={styles.goldLabel}>◈  SALDO TOTAL DE OURO  ◈</Text><Text style={styles.balance}>{display(balance)}</Text></View>
      </Panel>
      <Pressable onPress={()=>setScreen('Skills')}><Panel style={styles.skillBanner}><Text style={styles.skillTitle}>✦  ARTEMFOCO  <Text style={{color:BLUE}}>· SKILLS</Text></Text><Text style={styles.sub}>Módulo profissional em preparação  ›</Text></Panel></Pressable>
      <Caption>FLUXO FINANCEIRO PESSOAL · {month.split('-').reverse().join('/')}</Caption>
      <Panel><View style={styles.metrics}><View style={styles.metric}><Text style={styles.metricLabel}>RECEITAS DO MÊS</Text><Text style={[styles.metricValue,{color:GREEN}]}>{display(income)}</Text></View><View style={styles.metric}><Text style={styles.metricLabel}>DESPESAS DO MÊS</Text><Text style={[styles.metricValue,{color:RED}]}>{display(expense)}</Text></View></View></Panel>
      <Caption>ÚLTIMAS TRANSAÇÕES</Caption>
      {recent.length?recent.map(row):<Text style={styles.empty}>Nenhuma transação registrada.</Text>}
      <Caption>SEGURANÇA DOS DADOS</Caption>
      <Button label={backupBusy?'Aguarde...':'💾 Exportar backup'} secondary onPress={backupBusy?undefined:exportBackup}/>
      <Button label={backupBusy?'Aguarde...':'📥 Restaurar backup'} secondary onPress={backupBusy?undefined:restoreBackup}/>
      <Text style={styles.hint}>Mantenha seus backups em local privado. Arquivos JSON não são criptografados.</Text>
    </>}
    {screen==='Quests' && <><Panel><Text style={styles.pageTitle}>LOG DE QUESTS</Text><Text style={styles.sub}>Histórico de transações financeiras</Text></Panel><View style={styles.filters}>{[['todas','TODOS'],['receita','RECEITAS'],['despesa','DESPESAS']].map(([k,v])=><Pressable key={k} onPress={()=>setFilter(k)} style={[styles.filter,filter===k&&styles.filterActive]}><Text style={[styles.filterText,filter===k&&{color:'#09141E'}]}>{v}</Text></Pressable>)}</View>{items.filter(i=>filter==='todas'||i.type===filter).map(row)}{!items.length&&<Text style={styles.empty}>Nenhum lançamento encontrado.</Text>}<Text style={styles.hint}>Segure um lançamento para excluí-lo.</Text></>}
    {screen==='Skills' && <><Panel><Text style={styles.pageTitle}>✦ ARTEMFOCO</Text><Text style={styles.sub}>Habilidades profissionais · fotografia, vídeo e edição</Text></Panel>{['FOTOGRAFIA','VIDEOMAKER','EDITOR'].map((name,index)=><Panel key={name}><Text style={styles.skillTitle}>{index===0?'◈':'◇'}  {name}</Text><Text style={styles.sub}>{index===0?'Em breve: receitas, despesas e agenda de jobs.':'Módulo em preparação para uma próxima versão.'}</Text></Panel>)}<Text style={styles.hint}>Os lançamentos atuais ainda não são separados por perfil. Vamos implementar essa separação com uma migração segura do banco.</Text></>}
    {screen==='Builds' && <><Panel><Text style={styles.pageTitle}>⬡ BUILDS & INVESTIMENTOS</Text><Text style={styles.sub}>Sua árvore de patrimônio e rendimentos</Text></Panel><Panel><Text style={styles.skillTitle}>◇ BUILD RENDA FIXA</Text><Text style={styles.sub}>CDB, Tesouro e outros ativos — em breve</Text></Panel><Panel><Text style={styles.skillTitle}>◇ BUILD DIVIDENDOS</Text><Text style={styles.sub}>FIIs e ações — em breve</Text></Panel><Text style={styles.hint}>Nenhum patrimônio fictício é exibido nesta versão.</Text></>}
    {screen==='Bosses' && <><Panel><Text style={styles.pageTitle}>⚑ BOSS RAIDS & METAS</Text><Text style={styles.sub}>Derrote objetivos acumulando patrimônio</Text></Panel><Panel><Text style={styles.skillTitle}>✦ PRIMEIRA META</Text><Text style={styles.sub}>Criação e acompanhamento de metas em breve.</Text></Panel></>}
    </ScrollView>
    <View style={styles.nav}>{tabs.slice(0,2).map(([label,glyph])=><Pressable key={label} onPress={()=>setScreen(label)} style={styles.navItem}><Text style={[styles.navIcon,screen===label&&{color:GOLD}]}>{glyph}</Text><Text style={[styles.navText,screen===label&&{color:GOLD}]}>{label.toUpperCase()}</Text></Pressable>)}<Pressable style={styles.add} onPress={()=>setModal(true)}><Text style={styles.addText}>+</Text></Pressable>{tabs.slice(2).map(([label,glyph])=><Pressable key={label} onPress={()=>setScreen(label)} style={styles.navItem}><Text style={[styles.navIcon,screen===label&&{color:GOLD}]}>{glyph}</Text><Text style={[styles.navText,screen===label&&{color:GOLD}]}>{label.toUpperCase()}</Text></Pressable>)}</View>
    <Modal visible={modal} animationType="slide" onRequestClose={()=>setModal(false)}><KeyboardAvoidingView behavior={Platform.OS==='ios'?'padding':undefined} style={styles.root}><ScrollView contentContainerStyle={styles.form} keyboardShouldPersistTaps="handled">
      <Text style={styles.title}>REGISTRAR TRANSAÇÃO</Text><Text style={styles.sub}>MY BANK · HEXTECH EDITION</Text><View style={styles.switch}>{['despesa','receita'].map(t=><Pressable key={t} style={[styles.type,type===t&&styles.typeActive]} onPress={()=>setType(t)}><Text style={styles.rowTitle}>{t==='despesa'?'− GASTO':'+ RECEITA'}</Text></Pressable>)}</View>
      <Text style={styles.label}>VALOR (R$)</Text><TextInput style={styles.input} placeholder="Ex.: 39,90" placeholderTextColor={MUTED} value={amount} onChangeText={setAmount} keyboardType="decimal-pad"/>
      <Text style={styles.label}>DESCRIÇÃO</Text><TextInput style={styles.input} placeholder="Ex.: Almoço" placeholderTextColor={MUTED} value={description} onChangeText={setDescription}/>
      <Text style={styles.label}>CATEGORIA</Text><View style={styles.chips}>{categories.map(c=><Pressable key={c} onPress={()=>setCategory(c)} style={[styles.chip,category===c&&styles.chipActive]}><Text style={styles.chipText}>{c}</Text></Pressable>)}</View>
      <Text style={styles.label}>DATA (AAAA-MM-DD)</Text><TextInput style={styles.input} value={date} onChangeText={setDate} keyboardType="numbers-and-punctuation"/>
      <Button label={saving?'SALVANDO...':'CONFIRMAR E SALVAR'} onPress={saving?undefined:save}/><Button label="CANCELAR" secondary onPress={()=>setModal(false)}/>
    </ScrollView></KeyboardAvoidingView></Modal>
  </SafeAreaView>;
}
export default function App(){return <SQLiteProvider databaseName="financeiro.db" onInit={migrate} useSuspense><React.Suspense fallback={<View style={[styles.root,{justifyContent:'center'}]}><ActivityIndicator color={BLUE}/></View>}><AppContent/></React.Suspense></SQLiteProvider>}
const styles=StyleSheet.create({
 root:{flex:1,backgroundColor:BG},header:{flexDirection:'row',alignItems:'center',paddingHorizontal:18,paddingVertical:13,borderBottomWidth:1,borderBottomColor:'#243D46',gap:11},logo:{width:39,height:39,borderRadius:20,borderWidth:2,borderColor:GOLD,alignItems:'center',justifyContent:'center',backgroundColor:'#064353'},logoText:{fontSize:24,color:GOLD,fontWeight:'900'},brand:{fontSize:18,color:GOLD,fontWeight:'900',letterSpacing:2},tag:{fontSize:9,color:BLUE,letterSpacing:1.2,fontWeight:'700'},eye:{padding:9},content:{padding:14,paddingBottom:35},panel:{backgroundColor:PANEL,borderWidth:1,borderColor:'#34434A',borderRadius:16,padding:15,marginBottom:12},hero:{borderWidth:2,borderColor:GOLD},heroTop:{flexDirection:'row',justifyContent:'space-between',alignItems:'center',paddingBottom:12,borderBottomWidth:1,borderBottomColor:'#2B3D43'},heroTitle:{color:GOLD,fontSize:10,fontWeight:'900',letterSpacing:1.5},heroName:{color:WHITE,fontWeight:'900',fontSize:16,marginTop:6},xp:{color:BLUE,fontSize:10,fontWeight:'800',marginTop:14,marginBottom:8},track:{height:8,backgroundColor:'#071016',borderRadius:8,overflow:'hidden'},trackFill:{height:'100%',backgroundColor:BLUE},metrics:{flexDirection:'row',gap:9,marginTop:12},metric:{flex:1,backgroundColor:'#07121B',borderRadius:10,borderWidth:1,borderColor:'#253F47',padding:10},metricLabel:{fontSize:9,color:MUTED,fontWeight:'800'},metricValue:{fontSize:15,fontWeight:'900',marginTop:9},goldBanner:{marginTop:13,borderWidth:1,borderColor:'#785A28',backgroundColor:'#09131A',padding:14,borderRadius:11,alignItems:'center'},goldLabel:{fontSize:10,color:GOLD,fontWeight:'900',letterSpacing:1},balance:{color:WHITE,fontSize:28,fontWeight:'900',marginTop:7},skillBanner:{borderColor:'#0A857F'},skillTitle:{fontSize:14,color:GOLD,fontWeight:'900',letterSpacing:1},caption:{fontSize:11,color:GOLD,fontWeight:'900',letterSpacing:1,marginTop:12,marginBottom:11},sub:{color:MUTED,fontSize:11,marginTop:5},row:{flexDirection:'row',alignItems:'center',gap:9,padding:11,marginBottom:8,backgroundColor:PANEL,borderWidth:1,borderColor:'#273C42',borderRadius:12},rowIcon:{width:31,height:31,borderWidth:1,borderColor:'#0A857F',borderRadius:8,alignItems:'center',justifyContent:'center'},rowGlyph:{color:BLUE},rowTitle:{color:WHITE,fontSize:12,fontWeight:'800'},rowValue:{fontSize:11,fontWeight:'900'},empty:{color:MUTED,padding:14},hint:{fontSize:10,color:MUTED,lineHeight:17,marginTop:10,marginBottom:10},pageTitle:{color:GOLD,fontSize:15,fontWeight:'900',letterSpacing:1},filters:{flexDirection:'row',gap:7,marginBottom:14},filter:{paddingHorizontal:13,paddingVertical:10,backgroundColor:PANEL,borderRadius:8,borderWidth:1,borderColor:'#34434A'},filterActive:{backgroundColor:GOLD},filterText:{fontSize:10,color:WHITE,fontWeight:'900'},nav:{flexDirection:'row',alignItems:'center',justifyContent:'space-around',paddingVertical:9,paddingHorizontal:4,borderTopWidth:1,borderTopColor:'#785A28',backgroundColor:'#050B10'},navItem:{flex:1,alignItems:'center'},navIcon:{fontSize:18,color:'#7C8A8D'},navText:{fontSize:8,color:'#7C8A8D',fontWeight:'900',marginTop:3},add:{width:48,height:48,borderRadius:24,borderWidth:2,borderColor:GOLD,backgroundColor:'#064353',alignItems:'center',justifyContent:'center',marginHorizontal:3,marginTop:-20},addText:{color:BLUE,fontSize:29,fontWeight:'700'},button:{backgroundColor:'#785A28',borderColor:GOLD,borderWidth:1,borderRadius:12,padding:15,alignItems:'center',marginTop:10},buttonSecondary:{backgroundColor:'#16313A'},buttonDanger:{backgroundColor:RED},buttonText:{color:WHITE,fontWeight:'900',fontSize:12},form:{padding:22,paddingBottom:60},title:{color:GOLD,fontWeight:'900',fontSize:18,marginTop:10},switch:{flexDirection:'row',gap:10,marginTop:18},type:{flex:1,backgroundColor:PANEL,borderWidth:1,borderColor:'#34434A',padding:14,alignItems:'center',borderRadius:9},typeActive:{borderColor:GOLD,backgroundColor:'#25434A'},label:{color:GOLD,fontWeight:'900',fontSize:11,marginTop:19,marginBottom:8},input:{backgroundColor:PANEL,color:WHITE,padding:14,borderRadius:9,borderWidth:1,borderColor:'#34434A'},chips:{flexDirection:'row',flexWrap:'wrap',gap:7},chip:{padding:10,borderRadius:8,backgroundColor:PANEL,borderWidth:1,borderColor:'#34434A'},chipActive:{borderColor:GOLD,backgroundColor:'#244047'},chipText:{color:WHITE,fontSize:11}
});
