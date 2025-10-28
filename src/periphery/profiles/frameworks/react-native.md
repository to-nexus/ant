# React Native Framework Profile

## Component Structure
```typescript
import React from 'react';
import { View, Text, StyleSheet, TouchableOpacity } from 'react-native';

interface Props {
  title: string;
  onPress: () => void;
}

export function CustomButton({ title, onPress }: Props) {
  return (
    <TouchableOpacity style={styles.button} onPress={onPress}>
      <Text style={styles.text}>{title}</Text>
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  button: {
    backgroundColor: '#007AFF',
    padding: 16,
    borderRadius: 8,
  },
  text: {
    color: '#FFFFFF',
    fontSize: 16,
    fontWeight: '600',
  },
});
```

## Core Components
- **View**: Container (like `div`)
- **Text**: All text must be in `<Text>` (not `div` or `p`)
- **ScrollView**: Scrollable container
- **FlatList**: Optimized list for large datasets
- **Image**: Display images
- **TouchableOpacity**: Touchable wrapper with opacity feedback
- **Pressable**: Modern touchable with more control
- **TextInput**: Text input field

## Styling
```typescript
// ✅ StyleSheet API (preferred)
const styles = StyleSheet.create({
  container: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: '#F5F5F5',
  },
  text: {
    fontSize: 18,
    color: '#333333',
    marginBottom: 8,
  },
});

// ✅ Flexbox (default layout)
// - All containers are flexbox by default
// - Main axis: column (unlike web)
// - Use flex, justifyContent, alignItems

// ❌ Avoid inline styles (performance)
<View style={{ flex: 1, padding: 16 }} />  // OK for dynamic
<View style={styles.container} />  // Preferred
```

## Platform-Specific Code
```typescript
import { Platform } from 'react-native';

// ✅ Platform check
const styles = StyleSheet.create({
  container: {
    padding: Platform.OS === 'ios' ? 20 : 16,
    ...Platform.select({
      ios: {
        shadowColor: '#000',
        shadowOffset: { width: 0, height: 2 },
        shadowOpacity: 0.25,
      },
      android: {
        elevation: 4,
      },
    }),
  },
});

// ✅ Platform-specific files
// - Component.ios.tsx
// - Component.android.tsx
// - Component.tsx (shared)
```

## Navigation (React Navigation)
```typescript
import { NavigationContainer } from '@react-navigation/native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';

// ✅ Define navigation types
type RootStackParamList = {
  Home: undefined;
  Profile: { userId: string };
};

const Stack = createNativeStackNavigator<RootStackParamList>();

// ✅ Navigation prop typing
import type { NativeStackScreenProps } from '@react-navigation/native-stack';

type Props = NativeStackScreenProps<RootStackParamList, 'Profile'>;

function ProfileScreen({ route, navigation }: Props) {
  const { userId } = route.params;
  
  return (
    <View>
      <Text>User: {userId}</Text>
      <TouchableOpacity onPress={() => navigation.goBack()}>
        <Text>Go Back</Text>
      </TouchableOpacity>
    </View>
  );
}
```

## Lists (FlatList)
```typescript
// ✅ Good: Use FlatList for performance
<FlatList
  data={users}
  keyExtractor={item => item.id}
  renderItem={({ item }) => <UserCard user={item} />}
  ListEmptyComponent={<EmptyState />}
  ListHeaderComponent={<Header />}
  onEndReached={loadMore}
  onEndReachedThreshold={0.5}
/>

// ❌ Bad: ScrollView with map (performance issues for large lists)
<ScrollView>
  {users.map(user => <UserCard key={user.id} user={user} />)}
</ScrollView>
```

## Images
```typescript
import { Image } from 'react-native';

// ✅ Local images (require)
<Image
  source={require('../assets/logo.png')}
  style={{ width: 100, height: 100 }}
/>

// ✅ Remote images (uri)
<Image
  source={{ uri: 'https://example.com/image.jpg' }}
  style={{ width: 200, height: 200 }}
  resizeMode="cover"  // cover, contain, stretch, center
/>

// ✅ Use FastImage for better performance
import FastImage from 'react-native-fast-image';

<FastImage
  source={{ uri: imageUrl }}
  style={{ width: 200, height: 200 }}
  resizeMode={FastImage.resizeMode.cover}
/>
```

## Gestures and Animations
```typescript
import Animated, {
  useSharedValue,
  useAnimatedStyle,
  withSpring,
} from 'react-native-reanimated';

// ✅ React Native Reanimated (preferred)
function AnimatedBox() {
  const offset = useSharedValue(0);
  
  const animatedStyle = useAnimatedStyle(() => ({
    transform: [{ translateX: offset.value }],
  }));
  
  const handlePress = () => {
    offset.value = withSpring(offset.value + 50);
  };
  
  return (
    <Animated.View style={[styles.box, animatedStyle]}>
      <TouchableOpacity onPress={handlePress}>
        <Text>Move</Text>
      </TouchableOpacity>
    </Animated.View>
  );
}
```

## Safe Area
```typescript
import { SafeAreaView } from 'react-native-safe-area-context';

// ✅ Use SafeAreaView for proper insets
function Screen() {
  return (
    <SafeAreaView style={{ flex: 1 }}>
      <View style={styles.content}>
        <Text>Content</Text>
      </View>
    </SafeAreaView>
  );
}
```

## Best Practices
- **Use TypeScript** for all components
- **Use FlatList** for long lists, not ScrollView + map
- **Optimize images** - use appropriate sizes and formats
- **Handle keyboard** with KeyboardAvoidingView
- **Use StyleSheet.create** for performance
- **Test on both iOS and Android**
- **Use React Navigation** for routing
- **Leverage native modules** when needed (Camera, Location, etc.)
- **Use Reanimated** for smooth animations

## Performance Tips
- **useMemo/useCallback** for expensive operations
- **React.memo** for component memoization
- **getItemLayout** for FlatList when items have fixed height
- **removeClippedSubviews** for FlatList
- **Avoid anonymous functions** in renderItem
- **Use Hermes** JavaScript engine (enabled by default)

## Forbidden Patterns
- ❌ Web-only components (`div`, `span`, `p`)
- ❌ Inline styles for static styling
- ❌ ScrollView + map for large lists
- ❌ Not handling keyboard
- ❌ Not testing on both platforms
- ❌ Blocking main thread with heavy computations
- ❌ Not using SafeAreaView

