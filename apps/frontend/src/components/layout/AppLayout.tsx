import type { ReactNode } from "react";
import { Box } from "@mui/material";
import Sidebar from "./Sidebar";
import Topbar from "./Topbar";
import { operator } from "../../theme/operator";

interface Props {
  children: ReactNode;
}

export default function AppLayout({ children }: Props) {
  return (
    <Box
      sx={{
        display: "flex",
        minHeight: "100vh",
        bgcolor: operator.pageBg,
        color: "#12204a",
      }}
    >
      <Sidebar />

      <Box
        component="main"
        sx={{
          flexGrow: 1,
          minWidth: 0,
        }}
      >
        <Topbar />

        <Box
          sx={{
            width: "100%",
            maxWidth: 1320,
            mx: "auto",
            px: { xs: 2, md: 3 },
            py: 2,
          }}
        >
          {children}
        </Box>
      </Box>
    </Box>
  );
}
