import React from "react";
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  StatusBar,
  ScrollView,
  Dimensions,
  Platform,
} from "react-native";
import { useNavigation, useRoute } from "@react-navigation/native";
import { MaterialCommunityIcons } from "@expo/vector-icons";
import { useDispatch, useSelector } from "react-redux";
import { RootState } from "../../../store";
import { colors } from "../../../core/theme/colors";

const { width } = Dimensions.get("window");

const RuleItem = ({ icon, title, description }: { icon: string; title: string; description: string }) => (
  <View style={styles.ruleItem}>
    <Text style={styles.ruleTitle}>{title}</Text>
    <Text style={styles.ruleDescription}>{description}</Text>
  </View>
);

export const HouseRulesScreen = () => {
  const dispatch = useDispatch();
  const navigation = useNavigation<any>();
  const route = useRoute<any>();
  const auth = useSelector((state: RootState) => state.auth);
  const { intent } = route.params || {};
  const user = route.params?.user || auth.user;
  const token = route.params?.token || auth.token;

  const handleAgree = () => {
    navigation.navigate("NameSelection", { user, token, intent });
  };

  return (
    <>
      <StatusBar barStyle="light-content" backgroundColor="transparent" translucent />
      <View style={styles.container}>
        <ScrollView 
          contentContainerStyle={styles.scrollContent}
          showsVerticalScrollIndicator={false}
        >
          <TouchableOpacity 
            style={styles.closeButton}
            onPress={() => navigation.navigate("Welcome")}
          >
            <MaterialCommunityIcons name="close" size={28} color="#FFF" />
          </TouchableOpacity>

          <View style={styles.header}>
            <Text style={styles.titleEditorial}>
              <Text style={styles.serifItalic}>Welcome to </Text>
              <Text style={styles.sansText}>IEM Connect</Text>
            </Text>
            <Text style={styles.subtitle}>Please follow these house rules.</Text>
          </View>

          <View style={styles.rulesContainer}>
            <RuleItem 
              title="Be yourself."
              description="Make sure your photos, age and bio are true to who you are."
              icon="account-heart"
            />
            <RuleItem 
              title="Stay safe."
              description="Don't be too quick to give out personal information. Date safely."
              icon="shield-check"
            />
            <RuleItem 
              title="Play it cool."
              description="Respect others and treat them as you would like to be treated."
              icon="emoticon-cool"
            />
            <RuleItem 
              title="Be proactive."
              description="Always report bad behaviour."
              icon="alert-octagon"
            />
          </View>
        </ScrollView>

        <View style={styles.footer}>
          <TouchableOpacity 
            style={styles.button} 
            onPress={handleAgree}
            activeOpacity={0.8}
          >
            <Text style={styles.buttonText}>I Agree</Text>
          </TouchableOpacity>
        </View>
      </View>
    </>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: "#000",
  },
  scrollContent: {
    paddingHorizontal: 32,
    paddingTop: Platform.OS === "ios" ? 60 : 40,
    paddingBottom: 100,
  },
  closeButton: {
    marginBottom: 30,
    alignSelf: 'flex-start',
  },
  header: {
    marginBottom: 40,
  },
  logo: {
    marginBottom: 16,
  },
  titleEditorial: {
    marginBottom: 12,
  },
  serifItalic: {
    fontFamily: 'PlayfairDisplay_400Regular_Italic',
    fontSize: 42,
    color: '#FFF',
  },
  sansText: {
    fontFamily: "Inter_700Bold",
    fontSize: 36,
    color: "#FFF",
    letterSpacing: -1.5,
  },
  subtitle: {
    fontSize: 18,
    color: "rgba(255,255,255,0.6)",
    fontWeight: "500",
    marginTop: 8,
  },
  rulesContainer: {
    gap: 30,
  },
  ruleItem: {
    gap: 4,
  },
  ruleTitle: {
    fontSize: 22,
    fontWeight: "700",
    color: "#FFF",
  },
  ruleDescription: {
    fontSize: 17,
    color: "rgba(255,255,255,0.5)",
    lineHeight: 24,
  },
  footer: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    paddingHorizontal: 32,
    paddingBottom: Platform.OS === 'ios' ? 40 : 24,
    paddingTop: 20,
    backgroundColor: 'transparent',
  },
  button: {
    backgroundColor: "#FFF",
    paddingVertical: 18,
    borderRadius: 30,
    alignItems: "center",
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.3,
    shadowRadius: 10,
    elevation: 8,
  },
  buttonText: {
    color: "#000",
    fontSize: 18,
    fontWeight: "700",
    textTransform: "uppercase",
  },
});
