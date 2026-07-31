import { Document, Page, Text, View, StyleSheet } from "@react-pdf/renderer";

const styles = StyleSheet.create({
  page: { padding: 40, fontSize: 11, fontFamily: "Helvetica" },
  title: { fontSize: 20, marginBottom: 8, fontWeight: "bold" },
  subtitle: { fontSize: 12, marginBottom: 20, color: "#444" },
  section: { marginBottom: 14 },
  sectionTitle: { fontSize: 13, fontWeight: "bold", marginBottom: 6, borderBottom: "1pt solid #ccc", paddingBottom: 4 },
  row: { flexDirection: "row", marginBottom: 4 },
  label: { width: 140, fontWeight: "bold" },
  value: { flex: 1 },
  paragraph: { marginBottom: 6, lineHeight: 1.4 },
  tableHeader: { flexDirection: "row", borderBottom: "1pt solid #999", paddingBottom: 4, marginBottom: 4, fontWeight: "bold" },
  tableRow: { flexDirection: "row", marginBottom: 3 },
  colName: { width: "40%" },
  colScore: { width: "15%" },
  colNotes: { width: "45%" },
});

export interface ReportData {
  candidateName: string;
  candidateEmail: string;
  position: string;
  scenarioTitle: string;
  scenarioVersion: string;
  scenarioSlug: string;
  startedAt: string;
  completedAt: string;
  duration: string;
  status: string;
  objectivesCompleted: string;
  /** @deprecated */ gatesPassed: string;
  hintsUsed: number;
  unsafeActions: string[];
  overallScore: number | null;
  strengths: string;
  developmentAreas: string;
  recommendation: string;
  adminNotes: string;
  categoryScores: Array<{ name: string; score: number; notes: string }>;
}

export function AttemptReportDocument({ data }: { data: ReportData }) {
  return (
    <Document>
      <Page size="A4" style={styles.page}>
        <Text style={styles.title}>Practicum Vault — Assessment Report</Text>
        <Text style={styles.subtitle}>Confidential — For internal employee file use</Text>

        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Candidate</Text>
          <View style={styles.row}><Text style={styles.label}>Name</Text><Text style={styles.value}>{data.candidateName}</Text></View>
          <View style={styles.row}><Text style={styles.label}>Email</Text><Text style={styles.value}>{data.candidateEmail}</Text></View>
          <View style={styles.row}><Text style={styles.label}>Position</Text><Text style={styles.value}>{data.position || "—"}</Text></View>
        </View>

        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Scenario</Text>
          <View style={styles.row}><Text style={styles.label}>Scenario</Text><Text style={styles.value}>{data.scenarioTitle} ({data.scenarioSlug})</Text></View>
          <View style={styles.row}><Text style={styles.label}>Version</Text><Text style={styles.value}>{data.scenarioVersion}</Text></View>
          <View style={styles.row}><Text style={styles.label}>Status</Text><Text style={styles.value}>{data.status}</Text></View>
        </View>

        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Timing</Text>
          <View style={styles.row}><Text style={styles.label}>Started</Text><Text style={styles.value}>{data.startedAt}</Text></View>
          <View style={styles.row}><Text style={styles.label}>Completed</Text><Text style={styles.value}>{data.completedAt}</Text></View>
          <View style={styles.row}><Text style={styles.label}>Duration</Text><Text style={styles.value}>{data.duration}</Text></View>
        </View>

        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Results</Text>
          <View style={styles.row}><Text style={styles.label}>Final Score</Text><Text style={styles.value}>{data.overallScore ?? 0}/100</Text></View>
          <View style={styles.row}><Text style={styles.label}>Objectives Completed</Text><Text style={styles.value}>{data.objectivesCompleted ?? data.gatesPassed}</Text></View>
          <View style={styles.row}><Text style={styles.label}>Hints Used</Text><Text style={styles.value}>{data.hintsUsed}</Text></View>
          <View style={styles.row}><Text style={styles.label}>Unsafe Actions</Text><Text style={styles.value}>{data.unsafeActions.length ? data.unsafeActions.join("; ") : "None"}</Text></View>
        </View>

        {data.categoryScores.length > 0 && (
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>Category Scores</Text>
            <View style={styles.tableHeader}>
              <Text style={styles.colName}>Category</Text>
              <Text style={styles.colScore}>Score</Text>
              <Text style={styles.colNotes}>Notes</Text>
            </View>
            {data.categoryScores.map((c, i) => (
              <View key={i} style={styles.tableRow}>
                <Text style={styles.colName}>{c.name}</Text>
                <Text style={styles.colScore}>{c.score}</Text>
                <Text style={styles.colNotes}>{c.notes}</Text>
              </View>
            ))}
          </View>
        )}

        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Assessment</Text>
          <Text style={styles.paragraph}><Text style={{ fontWeight: "bold" }}>Strengths: </Text>{data.strengths || "—"}</Text>
          <Text style={styles.paragraph}><Text style={{ fontWeight: "bold" }}>Development areas: </Text>{data.developmentAreas || "—"}</Text>
          <Text style={styles.paragraph}><Text style={{ fontWeight: "bold" }}>Recommendation: </Text>{data.recommendation || "—"}</Text>
        </View>

        {data.adminNotes && (
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>Administrator Notes</Text>
            <Text style={styles.paragraph}>{data.adminNotes}</Text>
          </View>
        )}
      </Page>
    </Document>
  );
}
