import { useState } from 'react'

const mockPipelines = [
  { id: 1, name: 'frontend-build', status: 'success', duration: '2m 14s' },
  { id: 2, name: 'backend-deploy', status: 'running', duration: '1m 03s' },
  { id: 3, name: 'e2e-tests', status: 'failed', duration: '5m 47s' },
  { id: 4, name: 'lint-check', status: 'success', duration: '0m 32s' },
]

const statusColors: Record<string, string> = {
  success: 'bg-green-100 text-green-800',
  running: 'bg-blue-100 text-blue-800',
  failed: 'bg-red-100 text-red-800',
}

export default function Dashboard() {
  const [filter, setFilter] = useState('')

  const filtered = mockPipelines.filter((p) =>
    p.name.toLowerCase().includes(filter.toLowerCase())
  )

  return (
    <div className="space-y-8">
      <section>
        <h1 className="text-3xl font-bold text-gray-900 mb-4">Dashboard</h1>
        <p className="text-gray-600 leading-relaxed">
          Lorem ipsum dolor sit amet, consectetur adipiscing elit. Nullam auctor, nisl eget
          ultricies tincidunt, nisl nisl aliquam nisl, eget ultricies nisl nisl eget nisl.
        </p>
      </section>

      <section className="bg-white rounded-lg shadow p-6">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-xl font-semibold text-gray-800">Pipelines</h2>
          <button className="px-4 py-2 bg-green-600 text-white rounded-lg hover:bg-green-700 text-sm transition-colors">
            + New Pipeline
          </button>
        </div>
        <input
          type="text"
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
          placeholder="Filter pipelines..."
          className="w-full px-4 py-2 border border-gray-300 rounded-lg mb-4 focus:outline-none focus:ring-2 focus:ring-blue-500"
        />
        <div className="overflow-x-auto">
          <table className="w-full text-left">
            <thead>
              <tr className="border-b border-gray-200">
                <th className="pb-3 text-sm font-medium text-gray-500">Name</th>
                <th className="pb-3 text-sm font-medium text-gray-500">Status</th>
                <th className="pb-3 text-sm font-medium text-gray-500">Duration</th>
                <th className="pb-3 text-sm font-medium text-gray-500">Actions</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((p) => (
                <tr key={p.id} className="border-b border-gray-100">
                  <td className="py-3 font-medium text-gray-800">{p.name}</td>
                  <td className="py-3">
                    <span className={`px-2 py-1 rounded-full text-xs font-semibold ${statusColors[p.status]}`}>
                      {p.status}
                    </span>
                  </td>
                  <td className="py-3 text-gray-600">{p.duration}</td>
                  <td className="py-3">
                    <button className="text-blue-600 hover:underline text-sm mr-3">View</button>
                    <button className="text-red-600 hover:underline text-sm">Stop</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <div className="bg-white rounded-lg shadow p-6">
          <h3 className="text-lg font-semibold text-gray-800 mb-4">Build Stats</h3>
          <div className="space-y-3">
            <div>
              <div className="flex justify-between text-sm mb-1">
                <span className="text-gray-600">Success</span>
                <span className="font-medium">87%</span>
              </div>
              <div className="w-full bg-gray-200 rounded-full h-2">
                <div className="bg-green-500 h-2 rounded-full" style={{ width: '87%' }}></div>
              </div>
            </div>
            <div>
              <div className="flex justify-between text-sm mb-1">
                <span className="text-gray-600">Failed</span>
                <span className="font-medium">8%</span>
              </div>
              <div className="w-full bg-gray-200 rounded-full h-2">
                <div className="bg-red-500 h-2 rounded-full" style={{ width: '8%' }}></div>
              </div>
            </div>
            <div>
              <div className="flex justify-between text-sm mb-1">
                <span className="text-gray-600">Running</span>
                <span className="font-medium">5%</span>
              </div>
              <div className="w-full bg-gray-200 rounded-full h-2">
                <div className="bg-blue-500 h-2 rounded-full" style={{ width: '5%' }}></div>
              </div>
            </div>
          </div>
        </div>
        <div className="bg-white rounded-lg shadow p-6">
          <h3 className="text-lg font-semibold text-gray-800 mb-3">Quick Actions</h3>
          <div className="grid grid-cols-2 gap-3">
            <button className="px-4 py-3 border border-gray-300 rounded-lg hover:bg-gray-50 text-sm text-gray-700 transition-colors">
              Trigger Build
            </button>
            <button className="px-4 py-3 border border-gray-300 rounded-lg hover:bg-gray-50 text-sm text-gray-700 transition-colors">
              Run Tests
            </button>
            <button className="px-4 py-3 border border-gray-300 rounded-lg hover:bg-gray-50 text-sm text-gray-700 transition-colors">
              Deploy Staging
            </button>
            <button className="px-4 py-3 border border-gray-300 rounded-lg hover:bg-gray-50 text-sm text-gray-700 transition-colors">
              Deploy Prod
            </button>
          </div>
        </div>
      </section>
    </div>
  )
}