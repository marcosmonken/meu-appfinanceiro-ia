import React, { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, Alert, FlatList, KeyboardAvoidingView, Modal, Platform, Pressable, SafeAreaView, ScrollView, StatusBar, StyleSheet, Text, TextInput, View } from 'react-native';
import { SQLiteProvider, useSQLiteContext } from 'expo-sqlite';

const BG = '#090F1C', PANEL = '#142036', BLUE = '#4D91FF', MUTED = '#A5B3CA', WHITE = '#F4F7FF';
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
  const row = item => <Pressable key={item.id} style={styles.row} onLongPress={() => remove(item.id)}>
    <View style={{ flex: 1 }}><Text style={styles.rowTitle}>{item.description}</Text><Text style={styles.sub}>{item.category} · {dateText(item.date)}</Text></View>
    <Text style={[styles.rowValue, { color: item.type === 'receita' ? '#62D6A5' : '#FF8C9A' }]}>{item.type === 'receita' ? '+' : '−'} {brl(item.amount_cents / 100)}</Text>
  </Pressable>;
  return <SafeAreaView style={styles.root}><StatusBar barStyle="light-content" backgroundColor={BG}/>
    <View style={styles.header}><Text style={styles.brand}>MEU FINANCEIRO <Text style={{color:BLUE}}>IA</Text></Text><Text style={styles.sub}>Seu dinheiro, com clareza.</Text></View>
    <View style={styles.tabs}>{['Início', 'Transações'].map(s => <Pressable key={s} onPress={() => setScreen(s)} style={[styles.tab, screen===s && styles.tabActive]}><Text style={[styles.tabText, screen===s && {color:WHITE}]}>{s}</Text></Pressable>)}</View>
    {screen === 'Início' ? <ScrollView contentContainerStyle={styles.content}>
      <View style={styles.hero}><Text style={styles.sub}>Saldo acumulado registrado</Text><Text style={styles.balance}>{brl(balance)}</Text><Text style={styles.hint}>Saldo calculado somente a partir dos lançamentos cadastrados.</Text></View>
      <Text style={styles.section}>Resumo do mês · {month.split('-').reverse().join('/')}</Text>
      <View style={styles.metrics}><View style={styles.metric}><Text style={styles.sub}>↑ Receitas</Text><Text style={[styles.metricValue,{color:'#62D6A5'}]}>{brl(income)}</Text></View><View style={styles.metric}><Text style={styles.sub}>↓ Despesas</Text><Text style={[styles.metricValue,{color:'#FF8C9A'}]}>{brl(expense)}</Text></View></View>
      <Button label="+ Novo lançamento" onPress={() => setModal(true)}/>
      <Text style={styles.section}>Últimas movimentações</Text>
      {items.length ? items.slice(0,8).map(row) : <Text style={styles.empty}>Nenhum lançamento ainda. Cadastre sua primeira receita ou despesa.</Text>}
      <Text style={styles.hint}>Dica: pressione uma movimentação por alguns segundos para excluí-la.</Text>
    </ScrollView> : <View style={styles.contentFlex}>
      <View style={styles.filters}>{[['todas','Todas'],['receita','Receitas'],['despesa','Despesas']].map(([k,v]) => <Pressable key={k} style={[styles.filter,filter===k && styles.filterActive]} onPress={()=>setFilter(k)}><Text style={styles.filterText}>{v}</Text></Pressable>)}</View>
      <FlatList data={items.filter(i=>filter==='todas'||i.type===filter)} keyExtractor={i=>String(i.id)} renderItem={({item})=>row(item)} ListEmptyComponent={<Text style={styles.empty}>Nenhuma movimentação encontrada.</Text>} contentContainerStyle={{paddingBottom:100}}/>
      <Button label="+ Novo lançamento" onPress={() => setModal(true)}/>
    </View>}
    <Modal visible={modal} animationType="slide" onRequestClose={()=>setModal(false)}><KeyboardAvoidingView behavior={Platform.OS==='ios'?'padding':undefined} style={styles.root}><ScrollView contentContainerStyle={styles.form} keyboardShouldPersistTaps="handled">
      <Text style={styles.title}>Novo lançamento</Text><View style={styles.switch}>{['despesa','receita'].map(t=><Pressable key={t} style={[styles.type, type===t && styles.typeActive]} onPress={()=>setType(t)}><Text style={styles.rowTitle}>{t==='despesa'?'Despesa':'Receita'}</Text></Pressable>)}</View>
      <Text style={styles.label}>Valor (R$)</Text><TextInput style={styles.input} placeholder="Ex.: 39,90" placeholderTextColor={MUTED} value={amount} onChangeText={setAmount} keyboardType="decimal-pad"/>
      <Text style={styles.label}>Descrição</Text><TextInput style={styles.input} placeholder="Ex.: Almoço" placeholderTextColor={MUTED} value={description} onChangeText={setDescription}/>
      <Text style={styles.label}>Categoria</Text><View style={styles.chips}>{categories.map(c=><Pressable key={c} onPress={()=>setCategory(c)} style={[styles.chip, category===c && styles.chipActive]}><Text style={styles.chipText}>{c}</Text></Pressable>)}</View>
      <Text style={styles.label}>Data (AAAA-MM-DD)</Text><TextInput style={styles.input} placeholder="2026-10-27" placeholderTextColor={MUTED} value={date} onChangeText={setDate} keyboardType="numbers-and-punctuation"/>
      <Button label={saving?'Salvando...':'Salvar lançamento'} onPress={saving?undefined:save}/><Button label="Cancelar" secondary onPress={()=>setModal(false)}/>
    </ScrollView></KeyboardAvoidingView></Modal>
  </SafeAreaView>;
}
export default function App() { return <SQLiteProvider databaseName="financeiro.db" onInit={migrate} useSuspense><React.Suspense fallback={<View style={[styles.root,{justifyContent:'center'}]}><ActivityIndicator color={BLUE}/></View>}><AppContent/></React.Suspense></SQLiteProvider>; }
const styles=StyleSheet.create({root:{flex:1,backgroundColor:BG},header:{paddingHorizontal:22,paddingTop:22,paddingBottom:16},brand:{color:WHITE,fontWeight:'900',fontSize:21,letterSpacing:1},sub:{color:MUTED,fontSize:12,marginTop:5},tabs:{flexDirection:'row',marginHorizontal:20,marginBottom:10,backgroundColor:PANEL,borderRadius:12,padding:4},tab:{flex:1,padding:12,alignItems:'center',borderRadius:9},tabActive:{backgroundColor:'#263B5A'},tabText:{color:MUTED,fontWeight:'700'},content:{paddingHorizontal:20,paddingBottom:60},contentFlex:{flex:1,paddingHorizontal:20,paddingBottom:20},hero:{backgroundColor:PANEL,padding:24,borderRadius:20,marginTop:12},balance:{color:WHITE,fontSize:34,fontWeight:'900',marginTop:12},hint:{color:MUTED,fontSize:11,marginTop:12,lineHeight:17},section:{color:WHITE,fontSize:18,fontWeight:'800',marginTop:28,marginBottom:14},metrics:{flexDirection:'row',gap:12},metric:{flex:1,backgroundColor:PANEL,borderRadius:16,padding:15},metricValue:{fontSize:19,fontWeight:'800',marginTop:10},button:{backgroundColor:BLUE,borderRadius:14,padding:16,alignItems:'center',marginTop:18},buttonSecondary:{backgroundColor:'#263B5A'},buttonDanger:{backgroundColor:'#A33546'},buttonText:{color:WHITE,fontSize:15,fontWeight:'800'},row:{flexDirection:'row',alignItems:'center',paddingVertical:17,borderBottomColor:'#25334A',borderBottomWidth:1,gap:8},rowTitle:{color:WHITE,fontSize:14,fontWeight:'700'},rowValue:{fontWeight:'800',fontSize:13},empty:{color:MUTED,lineHeight:22,marginTop:12},filters:{flexDirection:'row',gap:8,marginTop:12},filter:{paddingHorizontal:12,paddingVertical:10,backgroundColor:PANEL,borderRadius:10},filterActive:{backgroundColor:'#28518B'},filterText:{color:WHITE,fontWeight:'700',fontSize:12},form:{padding:22,paddingBottom:60},title:{color:WHITE,fontSize:25,fontWeight:'900',marginBottom:20},switch:{flexDirection:'row',gap:10},type:{flex:1,backgroundColor:PANEL,alignItems:'center',padding:14,borderRadius:12},typeActive:{backgroundColor:'#28518B'},label:{color:WHITE,fontWeight:'700',marginTop:18,marginBottom:8},input:{backgroundColor:PANEL,color:WHITE,padding:15,borderRadius:12,fontSize:16},chips:{flexDirection:'row',flexWrap:'wrap',gap:8},chip:{backgroundColor:PANEL,paddingHorizontal:12,paddingVertical:10,borderRadius:10},chipActive:{backgroundColor:'#28518B'},chipText:{color:WHITE,fontSize:12,fontWeight:'600'}});
