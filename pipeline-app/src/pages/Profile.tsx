export default function Profile() {
  return (
    <div className="space-y-8">
      <section>
        <h1 className="text-3xl font-bold text-gray-900 mb-4">Profile</h1>
        <p className="text-gray-600 leading-relaxed">
          Lorem ipsum dolor sit amet, consectetur adipiscing elit. Proin gravida, nisl eget
          ultricies tincidunt, nisl nisl aliquam nisl, eget ultricies nisl nisl eget nisl.
        </p>
      </section>

      <section className="bg-white rounded-lg shadow p-6">
        <div className="flex items-start gap-6">
          <div className="w-20 h-20 bg-blue-600 rounded-full flex items-center justify-center text-white text-2xl font-bold shrink-0">
            JD
          </div>
          <div className="space-y-4 flex-1">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Full Name</label>
              <input
                type="text"
                defaultValue="Jane Doe"
                className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Email</label>
              <input
                type="email"
                defaultValue="jane.doe@example.com"
                className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Bio</label>
              <textarea
                rows={3}
                defaultValue="Lorem ipsum dolor sit amet, consectetur adipiscing elit. Sed do eiusmod tempor incididunt."
                className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
            </div>
          </div>
        </div>
      </section>

      <section className="bg-white rounded-lg shadow p-6">
        <h2 className="text-xl font-semibold text-gray-800 mb-4">Roles & Permissions</h2>
        <div className="space-y-3">
          {['Admin', 'Developer', 'Viewer'].map((role) => (
            <div key={role} className="flex items-center justify-between py-2 border-b border-gray-100 last:border-0">
              <span className="text-gray-700">{role}</span>
              <span className="px-3 py-1 bg-blue-100 text-blue-800 rounded-full text-xs font-semibold">
                Active
              </span>
            </div>
          ))}
        </div>
      </section>

      <div className="flex gap-3">
        <button className="px-6 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors">
          Update Profile
        </button>
        <button className="px-6 py-2 border border-gray-300 text-gray-700 rounded-lg hover:bg-gray-50 transition-colors">
          Cancel
        </button>
      </div>
    </div>
  )
}