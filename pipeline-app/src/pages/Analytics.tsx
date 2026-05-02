export default function Analytics() {
  const weeks = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']
  const values = [45, 72, 58, 90, 65, 30, 52]
  const maxVal = Math.max(...values)

  return (
    <div className="space-y-8">
      <section>
        <h1 className="text-3xl font-bold text-gray-900 mb-4">Analytics</h1>
        <p className="text-gray-600 leading-relaxed">
          Lorem ipsum dolor sit amet, consectetur adipiscing elit. Pellentesque habitant morbi
          tristique senectus et netus et malesuada fames ac turpis egestas.
        </p>
      </section>

      <section className="grid grid-cols-1 md:grid-cols-4 gap-4">
        {[
          { label: 'Total Builds', value: '1,847', change: '+12%' },
          { label: 'Avg Duration', value: '3m 24s', change: '-8%' },
          { label: 'Failures', value: '23', change: '+3%' },
          { label: 'Uptime', value: '99.9%', change: '+0.1%' },
        ].map((stat) => (
          <div key={stat.label} className="bg-white rounded-lg shadow p-5">
            <p className="text-sm font-medium text-gray-500">{stat.label}</p>
            <p className="text-2xl font-bold text-gray-900 mt-1">{stat.value}</p>
            <p className={`text-sm mt-1 ${stat.change.startsWith('+') && stat.label !== 'Failures' ? 'text-green-600' : 'text-red-600'}`}>
              {stat.change} from last week
            </p>
          </div>
        ))}
      </section>

      <section className="bg-white rounded-lg shadow p-6">
        <h2 className="text-xl font-semibold text-gray-800 mb-6">Weekly Build Activity</h2>
        <div className="flex items-end gap-4 h-48">
          {weeks.map((day, i) => (
            <div key={day} className="flex-1 flex flex-col items-center gap-2">
              <div className="w-full bg-blue-100 rounded-t relative" style={{ height: `${(values[i] / maxVal) * 100}%` }}>
                <div className="absolute inset-0 bg-blue-600 rounded-t opacity-80 hover:opacity-100 transition-opacity" />
              </div>
              <span className="text-xs text-gray-500">{day}</span>
            </div>
          ))}
        </div>
      </section>

      <section className="bg-white rounded-lg shadow p-6">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-xl font-semibold text-gray-800">Top Failing Stages</h2>
          <select className="px-3 py-1 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500">
            <option>Last 7 days</option>
            <option>Last 30 days</option>
            <option>Last 90 days</option>
          </select>
        </div>
        <div className="space-y-3">
          {[
            { stage: 'e2e-tests', failures: 12, total: 89 },
            { stage: 'integration', failures: 8, total: 134 },
            { stage: 'build-frontend', failures: 3, total: 156 },
          ].map((item) => (
            <div key={item.stage} className="flex items-center gap-4">
              <span className="w-32 text-sm text-gray-700 truncate">{item.stage}</span>
              <div className="flex-1 bg-gray-200 rounded-full h-3">
                <div
                  className="bg-red-500 h-3 rounded-full"
                  style={{ width: `${(item.failures / item.total) * 100}%` }}
                />
              </div>
              <span className="text-sm text-gray-600 w-16 text-right">
                {item.failures}/{item.total}
              </span>
            </div>
          ))}
        </div>
      </section>
    </div>
  )
}