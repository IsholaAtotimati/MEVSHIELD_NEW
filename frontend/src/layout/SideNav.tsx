import { NavLink } from "react-router-dom";

const links = [
  { to: "/", label: "Trade", end: true },
  { to: "/activity", label: "Activity" },
  { to: "/portfolio", label: "Portfolio" },
  { to: "/policies", label: "Policies" },
  { to: "/network", label: "Network" },
];

export default function SideNav() {
  return (
    <nav className="side-nav" aria-label="Main">
      <div className="side-nav-brand">MEVShield</div>
      <ul>
        {links.map((link) => (
          <li key={link.to}>
            <NavLink
              to={link.to}
              end={link.end}
              className={({ isActive }) =>
                isActive ? "side-nav-link active" : "side-nav-link"
              }
            >
              {link.label}
            </NavLink>
          </li>
        ))}
      </ul>
    </nav>
  );
}
