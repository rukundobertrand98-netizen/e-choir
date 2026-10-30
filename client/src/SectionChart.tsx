import {
  Bar,
  BarChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts'

export default function SectionChart({ data }: { data: { name: string; members: number }[] }) {
  return (
    <div className="chart-wrap">
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={data} margin={{ top: 10, right: 8, bottom: 0, left: -16 }} barCategoryGap="38%">
          <CartesianGrid vertical={false} stroke="#eeeaf2" strokeDasharray="4 4" />
          <XAxis dataKey="name" axisLine={false} tickLine={false} tick={{ fill: '#85818b', fontSize: 12 }} dy={9} />
          <YAxis allowDecimals={false} axisLine={false} tickLine={false} tick={{ fill: '#a09ba5', fontSize: 11 }} />
          <Tooltip cursor={{ fill: '#f7f5fa' }} contentStyle={{ border: '1px solid #eeeaf2', borderRadius: 10, boxShadow: '0 8px 24px #20133a12' }} />
          <Bar dataKey="members" fill="#7560a8" radius={[5, 5, 0, 0]} maxBarSize={42} />
        </BarChart>
      </ResponsiveContainer>
    </div>
  )
}
