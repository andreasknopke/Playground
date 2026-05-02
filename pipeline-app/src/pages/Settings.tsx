import { useState } from 'react'

export default function Settings() {
  const [appName, setAppName] = useState('Pipeline App')
  const [env, setEnv] = useState('staging')
  const [notifications, setNotifications] = useState(true)
  const [autoDeploy, setAutoDeploy] = useState(false)

  return (
    <div className="space-y-8">
      <section>
        <h1 className="text-3xl font-bold text-gray-900 mb-4">Settings</h1>
        <p className="text-gray-600 leading-relaxed">
          Lorem ipsum dolor sit amet, consectetur adipiscing elit. Fusce vel dui at augue
          feugiat vestibulum. Integer vehicula, ex eget commodo faucibus, risus magna lacinia
          orci, eget lacinia risus leo eget nunc.
        </p>
      </section>

      <section className="bg-white rounded-lg shadow p-6 space-y-6">
        <h2 className="text-xl font-semibold text-gray-800">General</h2>
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">Application Name</label>
          <input
            type="text"
            value={appName}
            onChange={(e) => setAppName(e.target.value)}
            className="w-full max-w-md px-4 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
          />
        </div>
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">Environment</label>
          <select
            value={env}
            onChange={(e) => setEnv(e.target.value)}
            className="w-full max-w-md px-4 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
          >
            <option value="development">Development</option>
            <option value="staging">Staging</option>
            <option value="production">Production</option>
          </select>
        </div>
      </section>

      <section className="bg-white rounded-lg shadow p-6 space-y-6">
        <h2 className="text-xl font-semibold text-gray-800">Flags</h2>
        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <div>
              <p className="font-medium text-gray-800">Email Notifications</p>
              <p className="text-sm text-gray-500">Lorem ipsum dolor sit amet for build alerts</p>
            </div>
            <button
              onClick={() => setNotifications(!notifications)}
              className={`relative w-12 h-6 rounded-full transition-colors ${notifications ? 'bg-blue-600' : 'bg-gray-300'}`}
            >
              <span
                className={`absolute top-0.5 left-0.5 w-5 h-5 bg-white rounded-full transition-transform ${notifications ? 'translate-x-6' : ''}`}
              />
            </button>
          </div>
          <div className="flex items-center justify-between">
            <div>
              <p className="font-medium text-gray-800">Auto-Deploy on Merge</p>
              <p className="text-sm text-gray-500">Consectetur adipiscing elit for main branch</p>
            </div>
            <button
              onClick={() => setAutoDeploy(!autoDeploy)}
              className={`relative w-12 h-6 rounded-full transition-colors ${autoDeploy ? 'bg-blue-600' : 'bg-gray-300'}`}
            >
              <span
                className={`absolute top-0.5 left-0.5 w-5 h-5 bg-white rounded-full transition-transform ${autoDeploy ? 'translate-x-6' : ''}`}
              />
            </button>
          </div>
        </div>
      </section>

      <section className="bg-white rounded-lg shadow p-6 space-y-4">
        <h2 className="text-xl font-semibold text-gray-800">Danger Zone</h2>
        <p className="text-gray-600">Lorem ipsum dolor sit amet — irreversible actions below.</p>
        <div className="flex gap-3">
          <button className="px-4 py-2 bg-red-600 text-white rounded-lg hover:bg-red-700 transition-colors">
            Reset Configuration
          </button>
          <button className="px-4 py-2 border border-red-300 text-red-700 rounded-lg hover:bg-red-50 transition-colors">
            Delete All Data
          </button>
        </div>
      </section>

      <div className="flex justify-end">
        <button className="px-6 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors">
          Save Settings
        </button>
      </div>
    </div>
  )
}