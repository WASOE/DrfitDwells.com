import { NavLink } from 'react-router-dom';
import { OPS_NAV_ITEMS, filterOpsNavItems } from './opsNavConfig';
import { useOpsSession } from '../../context/OpsSessionContext';

export default function OpsDesktopNav() {
  const session = useOpsSession();
  const items = filterOpsNavItems(OPS_NAV_ITEMS, session);

  if (items.length === 0) {
    return null;
  }

  return (
    <nav className="-mx-4 px-4 sm:mx-0 sm:px-0 overflow-x-auto border-t border-gray-100">
      <div className="flex items-center gap-1 min-w-max">
        {items.map((item) => (
          <NavLink
            key={item.to}
            to={item.to}
            end={item.end === true}
            className={({ isActive }) =>
              `px-3 py-2 text-sm border-b-2 whitespace-nowrap ${
                isActive ? 'text-[#81887A] border-[#81887A] font-medium' : 'text-gray-500 border-transparent hover:text-gray-800'
              }`
            }
          >
            {item.label}
          </NavLink>
        ))}
      </div>
    </nav>
  );
}
