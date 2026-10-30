import {
  Bar,
  BarChart,
  CartesianGrid,
  Legend,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts'
import { localeCode, translateText } from './i18n'
import type { Language } from './types'

type FinanceMonth = {
  month: string
  totalsByCurrency: { currency: string; income: number; expenses: number }[]
}

export default function FinanceChart({ data, currency, language }: { data: FinanceMonth[]; currency: string; language: Language }) {
  const rows = data.map((item) => {
    const totals = item.totalsByCurrency.find((entry) => entry.currency === currency)
    return {
      month: new Date(item.month).toLocaleString(localeCode(language), { month: 'short', year: '2-digit', timeZone: 'UTC' }),
      income: totals?.income ?? 0,
      expenses: totals?.expenses ?? 0,
    }
  })
  if (rows.every((row) => row.income === 0 && row.expenses === 0)) {
    return <div className="finance-chart-empty">{translateText(language, 'No paid activity in')} {currency} {translateText(language, 'during this period.')}</div>
  }
  return <div className="finance-chart">
    <ResponsiveContainer width="100%" height="100%">
      <BarChart data={rows} margin={{ top: 8, right: 8, bottom: 0, left: -14 }}>
        <CartesianGrid stroke="#efedf2" vertical={false} />
        <XAxis dataKey="month" tickLine={false} axisLine={false} tick={{ fill: '#898390', fontSize: 9 }} />
        <YAxis tickLine={false} axisLine={false} tick={{ fill: '#898390', fontSize: 9 }} />
        <Tooltip formatter={(value) => [`${Number(value).toLocaleString(localeCode(language))} ${currency}`]} />
        <Legend />
        <Bar dataKey="income" name={translateText(language, 'Income')} fill="#6f9d84" radius={[4, 4, 0, 0]} />
        <Bar dataKey="expenses" name={translateText(language, 'Expenses')} fill="#c98d83" radius={[4, 4, 0, 0]} />
      </BarChart>
    </ResponsiveContainer>
  </div>
}
