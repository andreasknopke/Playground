import { useState } from 'react'

export default function Home() {
  const [inputValue, setInputValue] = useState('')

  return (
    <div className="space-y-8">
      <section>
        <h1 className="text-3xl font-bold text-gray-900 mb-4">Home</h1>
        <p className="text-gray-600 leading-relaxed">
          Lorem ipsum dolor sit amet, consectetur adipiscing elit. Sed do eiusmod tempor
          incididunt ut labore et dolore magna aliqua. Ut enim ad minim veniam, quis nostrud
          exercitation ullamco laboris nisi ut aliquip ex ea commodo consequat.
        </p>
      </section>

      <section className="bg-white rounded-lg shadow p-6 space-y-4">
        <h2 className="text-xl font-semibold text-gray-800">Quick Search</h2>
        <div className="flex gap-3">
          <input
            type="text"
            value={inputValue}
            onChange={(e) => setInputValue(e.target.value)}
            placeholder="Search anything..."
            className="flex-1 px-4 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
          />
          <button className="px-6 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors">
            Search
          </button>
        </div>
      </section>

      <section className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <div className="bg-white rounded-lg shadow p-5">
          <h3 className="text-sm font-medium text-gray-500">Active Users</h3>
          <p className="text-2xl font-bold text-gray-900 mt-1">1,247</p>
          <p className="text-sm text-green-600 mt-1">+12.5% from last month</p>
        </div>
        <div className="bg-white rounded-lg shadow p-5">
          <h3 className="text-sm font-medium text-gray-500">Deployments</h3>
          <p className="text-2xl font-bold text-gray-900 mt-1">342</p>
          <p className="text-sm text-green-600 mt-1">+8.2% from last month</p>
        </div>
        <div className="bg-white rounded-lg shadow p-5">
          <h3 className="text-sm font-medium text-gray-500">Success Rate</h3>
          <p className="text-2xl font-bold text-gray-900 mt-1">98.7%</p>
          <p className="text-sm text-green-600 mt-1">+0.3% from last month</p>
        </div>
      </section>

      <section className="bg-white rounded-lg shadow p-6">
        <h2 className="text-xl font-semibold text-gray-800 mb-3">Recent Activity</h2>
        <ul className="space-y-3 text-gray-600">
          <li className="flex items-center gap-3">
            <span className="w-2 h-2 bg-green-500 rounded-full"></span>
            Lorem ipsum dolor sit amet — deployment #342 completed successfully
          </li>
          <li className="flex items-center gap-3">
            <span className="w-2 h-2 bg-blue-500 rounded-full"></span>
            Consectetur adipiscing elit — new pipeline stage added
          </li>
          <li className="flex items-center gap-3">
            <span className="w-2 h-2 bg-yellow-500 rounded-full"></span>
            Sed do eiusmod tempor — build in progress
          </li>
        </ul>
      </section>
    </div>
  )
}