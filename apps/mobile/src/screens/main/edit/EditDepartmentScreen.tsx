import {EditSaveFooter} from '../../../components/EditSaveFooter';
import {FormTitle, StudyField, formStyles} from '../../../components/ProfileEditForms';
import {ACADEMIC_COURSES as COURSE_DATA} from '../../../core/profile/profileOptions';

import React, {useState} from 'react';
import {View, ScrollView, Alert} from 'react-native';
import {useNavigation, useRoute} from '@react-navigation/native';
import {EditScreenHeader} from '../../../components/EditScreenHeader';
import {api} from '../../../services/api';
import {useDispatch} from 'react-redux';
import {updateUser} from '../../../store/authSlice';



export const EditDepartmentScreen = () => {
  const navigation = useNavigation<any>();
  const route = useRoute<any>();
  const dispatch = useDispatch();
  const { currentDepartment } = route.params || {};

  const [selectedCourse, setSelectedCourse] = useState<string | null>(currentDepartment || null);
  const [saving, setSaving] = useState(false);


const handleSave = async () => {
    if (!selectedCourse) return;
    setSaving(true);
    try {
      const data: any = { department: selectedCourse };
      const response = await api.put('/profile', data);
      if (!response.data?.success) throw new Error(response.data?.message || 'Could not save your changes.');
      if (response.data?.success) {
        dispatch(updateUser(response.data.data));
      }
      navigation.goBack();
    } catch (err: any) {
      Alert.alert('Error', err.response?.data?.message || 'Failed to update');
    } finally {
      setSaving(false);
    }
  };


  return <View style={formStyles.page}>
    <EditScreenHeader 
        title="Department" 
        onCancel={() => navigation.goBack()} 
        onSave={handleSave} 
        saving={saving} 
        saveDisabled={!selectedCourse}
        hasUnsavedChanges={
          selectedCourse !== null && selectedCourse !== (currentDepartment || null)
        }
      />
    <ScrollView keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false} contentContainerStyle={formStyles.content} pointerEvents={saving ? 'none' : 'auto'}>
      
      <FormTitle center>{'What do you\nstudy?'}</FormTitle>
      <View style={{marginTop: 24}}><StudyField showsVerticalScrollIndicator={false} label="Course / branch" value={selectedCourse || ''} searchable disabled={saving} options={[...(currentDepartment && !COURSE_DATA.some(group => group.courses.includes(currentDepartment)) ? [{id: currentDepartment, label: currentDepartment, group: 'Current course'}] : []), ...COURSE_DATA.flatMap(group => group.courses.map(course => ({id: course, label: course, group: group.title})))]} onSelect={setSelectedCourse}/></View>
    </ScrollView>
  <EditSaveFooter
      onSave={handleSave}
      saving={saving}
      saveDisabled={!selectedCourse}
      hasUnsavedChanges={
          selectedCourse !== null && selectedCourse !== (currentDepartment || null)
        }
    />
  </View>;
};
