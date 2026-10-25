import React, { useCallback, useEffect, useRef, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  FlatList,
  Image,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useFocusEffect, useNavigation, useRoute } from "@react-navigation/native";
import { ProfileDetailModal } from "../../features/discovery/components/profile-detail/ProfileDetailModal";
import {
  ExploreProfile,
  ExploreProfileCard,
} from "../../features/discovery/components/ExploreProfileCard";
import { Ionicons } from "@expo/vector-icons";
import { api } from "../../services/api";
import { onPreferencesChanged } from "../../features/discovery/preferencesEvents";
import { colors } from "../../core/theme/colors";
import { INTEREST_CATEGORIES } from "@iem-dating/shared/interest-catalog";
import { RoseSheetHost, type RoseSheetHostHandle } from "../../features/discovery/components/RoseSheet";
import { useRoses } from "../../features/discovery/useRoses";
import {
  encodeAttributes,
  type AttributeFilter,
  type ExploreState,
} from "../../features/discovery/exploreCategories";

type ExploreCard = ExploreProfile;
const interestChoices = INTEREST_CATEGORIES.flatMap((group) => group.interests);

/**
 * `searchBar` is the Search tab's entry into name search (SEARCH_SPEC.md 9),
 * drawn under the header so Explore stays the tab's browsing surface.
 */
export const ExploreScreen = ({ searchBar }: { searchBar?: React.ReactNode } = {}) => {
  const insets = useSafeAreaInsets();
  const navigation = useNavigation<any>();
  const [selected, setSelected] = useState<ExploreCard | null>(null);
  const [origin, setOrigin] = useState<{
    x: number;
    y: number;
    width: number;
    height: number;
  }>();
  const generation = useRef(0);
  const pending = useRef(false);
  const [cards, setCards] = useState<ExploreCard[]>([]);
  const [cursor, setCursor] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [selectedInterests, setSelectedInterests] = useState<string[]>([]);
  const [selectedAttributes, setSelectedAttributes] = useState<AttributeFilter[]>([]);
  const [privacyNotice, setPrivacyNotice] = useState<string | null>(null);
  // Which of the three empty states to show, straight from the server rather
  // than guessed from an empty list (EXPLORE_SPEC.md, sections 6 and 7.4).
  const [state, setState] = useState<ExploreState>("ok");
  const [missingField, setMissingField] = useState<string | null>(null);
  // Roses: the scarce Like, spent on the server inside the swipe transaction.
  const { balance: roseBalance, send: sendRose } = useRoses();
  // The sheet keeps who it is for itself, inside the open profile's window:
  // opening it must not re-render this screen and the profile (RoseSheetHost).
  const roseHost = useRef<RoseSheetHostHandle<ExploreCard>>(null);
  const seen = useRef(new Set<string>());

  // Arriving from the map with a campus or spot: show exactly those people,
  // under the same privacy floor as any other Explore filter (section 9).
  const route = useRoute<any>();
  useEffect(() => {
    const filter = route.params?.mapFilter as AttributeFilter | undefined;
    if (!filter) return;
    setSelectedInterests([]);
    setSelectedAttributes([filter]);
    navigation.setParams({ mapFilter: undefined });
  }, [route.params?.mapFilter]);
  // Arriving from Search's Interests section: Explore filtered to that one
  // interest, under Explore's own cohort floor (SEARCH_SPEC.md 9).
  useEffect(() => {
    const interest = route.params?.interest as string | undefined;
    if (!interest) return;
    setSelectedAttributes([]);
    setSelectedInterests([interest]);
    navigation.setParams({ interest: undefined });
  }, [route.params?.interest]);
  const mapFilter = selectedAttributes.find(
    (attribute) => attribute.key === "campus" || attribute.key === "place",
  );

  // A map spot or an interest from Search, shown as a banner you can clear.
  const routeInterest = selectedInterests[0]
    ? interestChoices.find((item) => item.id === selectedInterests[0])?.label ?? selectedInterests[0]
    : null;

  const load = useCallback(
    async (reset = false) => {
      if (pending.current && !reset) return;
      const requestGeneration = reset
        ? ++generation.current
        : generation.current;
      pending.current = true;
      setLoading(true);
      setPrivacyNotice(null);
      try {
        const response = await api.get("/search/explore", {
          params: {
            limit: 20,
            cursor: reset ? undefined : (cursor ?? undefined),
            interests: selectedInterests.join(",") || undefined,
            attributes: encodeAttributes(selectedAttributes),
          },
        });
        const data = response.data.data;
        if (requestGeneration !== generation.current) return;
        setState(data.state ?? "ok");
        setMissingField(data.missingField ?? null);
        setCards((current) =>
          reset
            ? data.cards
            : [
                ...current,
                ...data.cards.filter(
                  (card: ExploreCard) =>
                    !current.some((item) => item.id === card.id),
                ),
              ],
        );
        setCursor(data.nextCursor);
      } catch (cause: any) {
        if (requestGeneration !== generation.current) return;
        const code = cause?.response?.data?.code;
        if (code === "EXPLORE_FILTER_COMBINATION_LIMIT") {
          setCards([]);
          setCursor(null);
          setPrivacyNotice(
            "Use no more than two filters at once. A category counts as one.",
          );
        } else {
          setState("ok");
          setPrivacyNotice(
            "Explore could not load. Check your connection and try again.",
          );
        }
      } finally {
        if (requestGeneration === generation.current) {
          pending.current = false;
          setLoading(false);
        }
      }
    },
    [cursor, loading, selectedInterests, selectedAttributes],
  );

  // A grid only when something asks for one: a map spot, or an interest
  // from Search. On its own, Browse has nothing to list yet.
  const hasFilter = selectedInterests.length > 0 || selectedAttributes.length > 0;
  useEffect(() => {
    setCards([]);
    setCursor(null);
    seen.current.clear();
    setState("ok");
    setPrivacyNotice(null);
    if (hasFilter) load(true);
  }, [
    selectedInterests.join(","),
    selectedAttributes.map((item) => `${item.key}:${item.value}`).join(","),
  ]);

  // My preferences saved: Browse re-reads under the new filters.
  const loadRef = useRef(load);
  loadRef.current = load;
  const hasFilterRef = useRef(hasFilter);
  hasFilterRef.current = hasFilter;
  useEffect(
    () =>
      onPreferencesChanged(() => {
        setCards([]);
        setCursor(null);
        seen.current.clear();
        if (hasFilterRef.current) void loadRef.current(true);
      }),
    [],
  );

  /** Clears the map or interest filter. */
  const broaden = () => {
    setSelectedAttributes([]);
    setSelectedInterests([]);
  };
  const canBroaden = hasFilter;

  const follow = async (card: ExploreCard) => {
    if (card.followStatus) return;
    const confirmed = await new Promise<boolean>((resolve) =>
      Alert.alert(
        "Send follow request?",
        `${card.name} will immediately see your profile and that you requested to follow them. Dating Likes stay private unless you both Like each other.`,
        [
          { text: "Cancel", style: "cancel", onPress: () => resolve(false) },
          { text: "Send request", onPress: () => resolve(true) },
        ],
        { cancelable: true, onDismiss: () => resolve(false) },
      ),
    );
    if (!confirmed) return;
    await api.post("/stories/follows", {
      userId: card.id,
      disclosureAccepted: true,
    });
    setCards((current) =>
      current.map((item) =>
        item.id === card.id ? { ...item, followStatus: "pending" } : item,
      ),
    );
    setSelected((current) =>
      current?.id === card.id
        ? { ...current, followStatus: "pending" }
        : current,
    );
  };

  const swipe = async (card: ExploreCard, action: "like" | "pass") => {
    await api
      .post("/discover/visible", { impressionId: card.impressionId })
      .catch(() => undefined);
    const response = await api.post("/discover/swipe", {
      targetId: card.id,
      action,
    });
    setCards((current) => current.filter((item) => item.id !== card.id));
    if (response.data.data?.matchCreated)
      Alert.alert("It's a match!", `You and ${card.name} liked each other.`);
  };

  /** A Rose is a Like, so the card leaves the grid exactly as a Like would. */
  const rose = async (card: ExploreCard, comment: string | null) => {
    await api
      .post("/discover/visible", { impressionId: card.impressionId })
      .catch(() => undefined);
    const result = await sendRose(card.id, comment);
    if (!result) return; // useRoses already explained the refusal.
    roseHost.current?.close();
    setSelected(null);
    setCards((current) => current.filter((item) => item.id !== card.id));
    if (result.matchCreated) {
      Alert.alert("It's a match!", `You and ${card.name} liked each other.`);
    }
  };

  const visible = useRef(({ viewableItems }: any) => {
    for (const view of viewableItems) {
      const card = view.item as ExploreCard;
      if (!seen.current.has(card.impressionId)) {
        seen.current.add(card.impressionId);
        api
          .post("/discover/visible", { impressionId: card.impressionId })
          .catch(() => undefined);
      }
    }
  }).current;

  return (
    <View style={[styles.container, { paddingTop: insets.top + 8 }]}>
      <View style={styles.browseHeader}>
        <View style={styles.browseHeaderRow}>
          <Text style={styles.title}>Browse</Text>
          <View style={styles.headerActions}>
            <Pressable
              onPress={() => navigation.navigate("Map")}
              accessibilityRole="button"
              accessibilityLabel="Map of people around you"
              style={styles.filterButton}
            >
              <Ionicons name="map-outline" size={21} color="#fff" />
            </Pressable>
          </View>
        </View>
        <Text style={styles.browseSubtitle}>People at your college, by what you share.</Text>
      </View>
      {searchBar}
      {!!mapFilter && (
        <View style={styles.mapBanner}>
          <Ionicons name="map-outline" size={16} color="#fff" />
          <Text style={styles.mapBannerText} numberOfLines={1}>
            {/* A place means they like it, never that they are there. */}
            {mapFilter.key === "place" ? `People who like ${mapFilter.label}` : `People from ${mapFilter.label}`}
          </Text>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Clear map filter"
            onPress={broaden}
          >
            <Ionicons name="close-circle" size={20} color="#B8B8C0" />
          </Pressable>
        </View>
      )}
      {!!routeInterest && !mapFilter && (
        <View style={styles.mapBanner}>
          <Ionicons name="sparkles-outline" size={16} color="#fff" />
          <Text style={styles.mapBannerText} numberOfLines={1}>
            People into {routeInterest}
          </Text>
          <Pressable accessibilityRole="button" accessibilityLabel="Clear interest filter" onPress={broaden}>
            <Ionicons name="close-circle" size={20} color="#B8B8C0" />
          </Pressable>
        </View>
      )}
      {!!privacyNotice && (
        <Text accessibilityLiveRegion="polite" style={styles.privacyNotice}>
          {privacyNotice}
        </Text>
      )}
      <FlatList
        accessibilityLabel="Eligible profiles"
        data={cards}
        numColumns={2}
        keyExtractor={(item) => item.id}
        onViewableItemsChanged={visible}
        viewabilityConfig={{
          itemVisiblePercentThreshold: 60,
          minimumViewTime: 700,
        }}
        contentContainerStyle={styles.grid}
        columnWrapperStyle={styles.row}
        refreshControl={
          <RefreshControl
            refreshing={loading && cards.length > 0}
            onRefresh={() => load(true)}
            tintColor={colors.primary}
          />
        }
        onEndReached={() => cursor && load()}
        onEndReachedThreshold={0.5}
        ListFooterComponent={
          loading ? <ActivityIndicator color={colors.primary} /> : null
        }
        ListEmptyComponent={
          !loading && !hasFilter ? (
            <View style={styles.searchGuide}>
              <Image source={require("../../../assets/illustrations/browse-kitten.png")}
                style={styles.browseKitten} resizeMode="contain" accessible={false} />
              <Text style={styles.searchGuideTitle}>Looking for someone?</Text>
              <Text style={styles.searchGuideHint}>Try their name in the search bar above.</Text>
            </View>
          ) : !loading && hasFilter ? (
            // Three distinct states, never inferred from an empty list
            // (EXPLORE_SPEC.md, section 6).
            <View style={styles.emptyBlock}>
              {state === "cohort_too_small" ? (
                <>
                  <Ionicons
                    name="people-outline"
                    size={34}
                    color={colors.text.tertiary}
                  />
                  <Text style={styles.empty}>
                    Not enough people match this to show it privately. Try a
                    broader filter.
                  </Text>
                  {canBroaden && (
                    <Pressable onPress={broaden}>
                      <Text style={styles.more}>Broaden</Text>
                    </Pressable>
                  )}
                </>
              ) : state === "exhausted" ? (
                <>
                  <Ionicons
                    name="checkmark-done-outline"
                    size={34}
                    color={colors.text.tertiary}
                  />
                  <Text style={styles.empty}>
                    You've seen everyone in this filter.
                  </Text>
                  {canBroaden && (
                    <Pressable onPress={broaden}>
                      <Text style={styles.more}>Broaden</Text>
                    </Pressable>
                  )}
                </>
              ) : (
                <>
                  <Text style={styles.empty}>
                    No one to show here right now.
                  </Text>
                  {cursor && (
                    <Pressable onPress={() => load()}>
                      <Text style={styles.more}>Check more profiles</Text>
                    </Pressable>
                  )}
                </>
              )}
            </View>
          ) : null
        }
        renderItem={({ item }) => (
          <ExploreProfileCard
            profile={item}
            onOpen={(profile, cardOrigin) => {
              setOrigin(cardOrigin);
              setSelected(profile);
            }}
          />
        )}
      />
      {selected && (
        <ProfileDetailModal
          user={selected}
          initialPhotoUri={selected.primaryPhoto ?? undefined}
          origin={origin}
          isVisible
          onClose={() => setSelected(null)}
          onLike={() => swipe(selected, "like")}
          onPass={() => swipe(selected, "pass")}
          onRose={() => roseHost.current?.open(selected)}
          roseBalance={roseBalance?.roses ?? null}
          overlay={<RoseSheetHost<ExploreCard> ref={roseHost} inline balance={roseBalance?.roses ?? null}
            onSend={(card, comment) => rose(card, comment)} />}
          onOverlayBack={() => roseHost.current?.back() ?? false}
          onFollow={
            selected.canRequestFollow && !selected.followStatus
              ? () => follow(selected)
              : undefined
          }
          onBlocked={() =>
            setCards((items) => items.filter((item) => item.id !== selected.id))
          }
        />
      )}
    </View>
  );
};

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: "#100F0D" },
  title: { color: "#FFFFFF", fontSize: 28, fontWeight: "800", flex: 1, minWidth: 0 },
  subtitle: { color: "#FFFFFF", fontSize: 14, marginTop: 5, marginBottom: 12 },
  browseHeader: { paddingHorizontal: 16, marginBottom: 8, flexShrink: 0 },
  browseHeaderRow: { flexDirection: "row", alignItems: "center", gap: 12, minHeight: 44 },
  browseSubtitle: { color: "#FFFFFF", fontSize: 13, lineHeight: 18, marginTop: 2 },
  header: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    paddingHorizontal: 20,
    marginBottom: 12,
  },
  headerActions: { flexDirection: "row", alignItems: "center", gap: 8, flexShrink: 0, transform: [{ translateY: 3 }] },
  mapBanner: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    marginHorizontal: 16,
    marginBottom: 8,
    paddingHorizontal: 12,
    paddingVertical: 9,
    borderRadius: 12,
    backgroundColor: "#24201F",
  },
  mapBannerText: { color: "#fff", fontSize: 14, flex: 1 },
  filterButton: {
    width: 44,
    height: 44,
    borderRadius: 22,
    flexShrink: 0,
    backgroundColor: "#24201F",
    alignItems: "center",
    justifyContent: "center",
  },
  filterDot: {
    position: "absolute",
    top: 7,
    right: 7,
    width: 7,
    height: 7,
    borderRadius: 4,
    backgroundColor: colors.primary,
  },
  filterBackdrop: { flex: 1, backgroundColor: "#00000088" },
  filterSheet: {
    backgroundColor: "#1E1B1A",
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    padding: 18,
  },
  filterChoices: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 8,
    paddingVertical: 10,
  },
  done: {
    backgroundColor: colors.primary,
    padding: 16,
    borderRadius: 24,
    alignItems: "center",
    marginTop: 15,
  },
  categoryList: { flexGrow: 0, flexShrink: 0 },
  categories: { paddingHorizontal: 16, gap: 8, paddingBottom: 10 },
  interests: { paddingHorizontal: 16, gap: 7, paddingBottom: 12 },
  interest: {
    paddingHorizontal: 12,
    height: 30,
    borderRadius: 15,
    backgroundColor: "#2B2524",
    justifyContent: "center",
  },
  interestActive: { backgroundColor: "#543035" },
  interestText: { color: "#FFFFFF", fontSize: 12 },
  interestTextActive: { color: "#FFFFFF", fontWeight: "700" },
  privacyNotice: {
    color: "#FFFFFF",
    fontSize: 13,
    lineHeight: 18,
    paddingHorizontal: 16,
    paddingBottom: 8,
  },
  category: {
    minHeight: 36,
    paddingVertical: 8,
    paddingHorizontal: 15,
    borderRadius: 18,
    backgroundColor: "#2B2524",
    justifyContent: "center",
  },
  categoryActive: {
    backgroundColor: colors.primary,
  },
  categoryText: { color: "#FFFFFF", fontWeight: "600" },
  categoryTextActive: { color: "#fff" },
  grid: { paddingHorizontal: 12, paddingBottom: 120, flexGrow: 1 },
  row: { gap: 10 },
  name: { color: "#FFFFFF", fontSize: 17, fontWeight: "700" },
  empty: {
    color: "#FFFFFF",
    textAlign: "center",
    marginTop: 14,
    paddingHorizontal: 30,
    lineHeight: 20,
  },
  emptyBlock: { alignItems: "center", marginTop: 72 },
  searchGuide: { alignItems: "center", paddingHorizontal: 24, paddingTop: 28 },
  browseKitten: { width: 112, height: 168 },
  searchGuideTitle: { color: "#FFFFFF", fontSize: 18, fontWeight: "700", textAlign: "center", marginTop: 16 },
  searchGuideHint: { color: "#B8BDC2", fontSize: 14, lineHeight: 20, textAlign: "center", marginTop: 6 },
  pinned: { marginBottom: 18 },
  pinnedHeading: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    marginBottom: 8,
  },
  pinnedTitle: {
    color: "#FFFFFF",
    fontSize: 13,
    fontWeight: "700",
    letterSpacing: 0.3,
  },
  pinnedScore: { color: "#FFFFFF", fontSize: 13, fontWeight: "700" },
  more: {
    color: "#FFFFFF",
    textAlign: "center",
    marginTop: 14,
    fontWeight: "700",
  },
  filterGroupTitle: {
    color: "#FFFFFF",
    fontSize: 12,
    fontWeight: "700",
    textTransform: "uppercase",
    letterSpacing: 0.6,
    marginTop: 16,
    marginBottom: 8,
  },
  lockedNote: {
    color: "#FFFFFF",
    fontSize: 12,
    lineHeight: 17,
    marginTop: 10,
  },
});
