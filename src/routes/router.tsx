import { createBrowserRouter, Navigate } from "react-router-dom";
import Login from "../pages/login/Login";
import Profile from "../pages/profile/Profile";
import Meet from "../pages/meet/Meet";

export const routes = [
  {
    path: "/",
    element: <Navigate to="/meet" replace />,
  },
  {
    path: "/login",
    element: <Login />,
  },
  {
    path: "/profile",
    element: <Profile />,
  },
  {
    path: "/meet",
    element: <Meet />,
  },
];

export const router = createBrowserRouter(routes);
